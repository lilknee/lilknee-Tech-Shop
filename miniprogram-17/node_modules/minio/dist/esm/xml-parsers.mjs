/*
 * MinIO Javascript Library for Amazon S3 Compatible Cloud Storage, (C) 2015 MinIO, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import crc32 from 'buffer-crc32';
import { XMLParser } from 'fast-xml-parser';
import * as errors from "./errors.mjs";
import { SelectResults } from "./helpers.mjs";
import { isObject, parseXml, readableStream, sanitizeETag, sanitizeObjectKey, sanitizeSize, toArray } from "./internal/helper.mjs";
import { RETENTION_VALIDITY_UNITS } from "./internal/type.mjs";
const fxpWithoutNumParser = new XMLParser({
  numberParseOptions: {
    skipLike: /./
  }
});

// parse XML response for copy object
export function parseCopyObject(xml) {
  var result = {
    etag: '',
    lastModified: ''
  };
  var xmlobj = parseXml(xml);
  if (!xmlobj.CopyObjectResult) {
    throw new errors.InvalidXMLError('Missing tag: "CopyObjectResult"');
  }
  xmlobj = xmlobj.CopyObjectResult;
  if (xmlobj.ETag) {
    result.etag = xmlobj.ETag.replace(/^"/g, '').replace(/"$/g, '').replace(/^&quot;/g, '').replace(/&quot;$/g, '').replace(/^&#34;/g, '').replace(/&#34;$/g, '');
  }
  if (xmlobj.LastModified) {
    result.lastModified = new Date(xmlobj.LastModified);
  }
  return result;
}

// parse XML response for listing in-progress multipart uploads
export function parseListMultipart(xml) {
  var result = {
    uploads: [],
    prefixes: [],
    isTruncated: false
  };
  var xmlobj = parseXml(xml);
  if (!xmlobj.ListMultipartUploadsResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListMultipartUploadsResult"');
  }
  xmlobj = xmlobj.ListMultipartUploadsResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextKeyMarker) {
    result.nextKeyMarker = xmlobj.NextKeyMarker;
  }
  if (xmlobj.NextUploadIdMarker) {
    result.nextUploadIdMarker = xmlobj.nextUploadIdMarker || '';
  }
  if (xmlobj.CommonPrefixes) {
    toArray(xmlobj.CommonPrefixes).forEach(prefix => {
      result.prefixes.push({
        prefix: sanitizeObjectKey(toArray(prefix.Prefix)[0])
      });
    });
  }
  if (xmlobj.Upload) {
    toArray(xmlobj.Upload).forEach(upload => {
      var key = upload.Key;
      var uploadId = upload.UploadId;
      var initiator = {
        id: upload.Initiator.ID,
        displayName: upload.Initiator.DisplayName
      };
      var owner = {
        id: upload.Owner.ID,
        displayName: upload.Owner.DisplayName
      };
      var storageClass = upload.StorageClass;
      var initiated = new Date(upload.Initiated);
      result.uploads.push({
        key,
        uploadId,
        initiator,
        owner,
        storageClass,
        initiated
      });
    });
  }
  return result;
}

// parse XML response to list all the owned buckets

// parse XML response for bucket notification
export function parseBucketNotification(xml) {
  var result = {
    TopicConfiguration: [],
    QueueConfiguration: [],
    CloudFunctionConfiguration: []
  };
  // Parse the events list
  var genEvents = function (events) {
    var result = [];
    if (events) {
      toArray(events).forEach(s3event => {
        result.push(s3event);
      });
    }
    return result;
  };
  // Parse all filter rules
  var genFilterRules = function (filters) {
    var result = [];
    if (filters) {
      filters = toArray(filters);
      if (filters[0].S3Key) {
        filters[0].S3Key = toArray(filters[0].S3Key);
        if (filters[0].S3Key[0].FilterRule) {
          toArray(filters[0].S3Key[0].FilterRule).forEach(rule => {
            var Name = toArray(rule.Name)[0];
            var Value = toArray(rule.Value)[0];
            result.push({
              Name,
              Value
            });
          });
        }
      }
    }
    return result;
  };
  var xmlobj = parseXml(xml);
  xmlobj = xmlobj.NotificationConfiguration;

  // Parse all topic configurations in the xml
  if (xmlobj.TopicConfiguration) {
    toArray(xmlobj.TopicConfiguration).forEach(config => {
      var Id = toArray(config.Id)[0];
      var Topic = toArray(config.Topic)[0];
      var Event = genEvents(config.Event);
      var Filter = genFilterRules(config.Filter);
      result.TopicConfiguration.push({
        Id,
        Topic,
        Event,
        Filter
      });
    });
  }
  // Parse all topic configurations in the xml
  if (xmlobj.QueueConfiguration) {
    toArray(xmlobj.QueueConfiguration).forEach(config => {
      var Id = toArray(config.Id)[0];
      var Queue = toArray(config.Queue)[0];
      var Event = genEvents(config.Event);
      var Filter = genFilterRules(config.Filter);
      result.QueueConfiguration.push({
        Id,
        Queue,
        Event,
        Filter
      });
    });
  }
  // Parse all QueueConfiguration arrays
  if (xmlobj.CloudFunctionConfiguration) {
    toArray(xmlobj.CloudFunctionConfiguration).forEach(config => {
      var Id = toArray(config.Id)[0];
      var CloudFunction = toArray(config.CloudFunction)[0];
      var Event = genEvents(config.Event);
      var Filter = genFilterRules(config.Filter);
      result.CloudFunctionConfiguration.push({
        Id,
        CloudFunction,
        Event,
        Filter
      });
    });
  }
  return result;
}

// parse XML response when a multipart upload is completed
export function parseCompleteMultipart(xml) {
  var xmlobj = parseXml(xml).CompleteMultipartUploadResult;
  if (xmlobj.Location) {
    var location = toArray(xmlobj.Location)[0];
    var bucket = toArray(xmlobj.Bucket)[0];
    var key = xmlobj.Key;
    var etag = xmlobj.ETag.replace(/^"/g, '').replace(/"$/g, '').replace(/^&quot;/g, '').replace(/&quot;$/g, '').replace(/^&#34;/g, '').replace(/&#34;$/g, '');
    return {
      location,
      bucket,
      key,
      etag
    };
  }
  // Complete Multipart can return XML Error after a 200 OK response
  if (xmlobj.Code && xmlobj.Message) {
    var errCode = toArray(xmlobj.Code)[0];
    var errMessage = toArray(xmlobj.Message)[0];
    return {
      errCode,
      errMessage
    };
  }
}
const formatObjInfo = (content, opts = {}) => {
  let {
    Key,
    LastModified,
    ETag,
    Size,
    VersionId,
    IsLatest
  } = content;
  if (!isObject(opts)) {
    opts = {};
  }
  const name = sanitizeObjectKey(toArray(Key)[0]);
  const lastModified = new Date(toArray(LastModified)[0]);
  const etag = sanitizeETag(toArray(ETag)[0]);
  const size = sanitizeSize(Size);
  return {
    name,
    lastModified,
    etag,
    size,
    versionId: VersionId,
    isLatest: IsLatest,
    isDeleteMarker: opts.IsDeleteMarker ? opts.IsDeleteMarker : false
  };
};

// parse XML response for list objects in a bucket
export function parseListObjects(xml) {
  var result = {
    objects: [],
    isTruncated: false
  };
  let isTruncated = false;
  let nextMarker, nextVersionKeyMarker;
  const xmlobj = fxpWithoutNumParser.parse(xml);
  const parseCommonPrefixesEntity = responseEntity => {
    if (responseEntity) {
      toArray(responseEntity).forEach(commonPrefix => {
        result.objects.push({
          prefix: sanitizeObjectKey(toArray(commonPrefix.Prefix)[0]),
          size: 0
        });
      });
    }
  };
  const listBucketResult = xmlobj.ListBucketResult;
  const listVersionsResult = xmlobj.ListVersionsResult;
  if (listBucketResult) {
    if (listBucketResult.IsTruncated) {
      isTruncated = listBucketResult.IsTruncated;
    }
    if (listBucketResult.Contents) {
      toArray(listBucketResult.Contents).forEach(content => {
        const name = sanitizeObjectKey(toArray(content.Key)[0]);
        const lastModified = new Date(toArray(content.LastModified)[0]);
        const etag = sanitizeETag(toArray(content.ETag)[0]);
        const size = sanitizeSize(content.Size);
        result.objects.push({
          name,
          lastModified,
          etag,
          size
        });
      });
    }
    if (listBucketResult.NextMarker) {
      nextMarker = listBucketResult.NextMarker;
    }
    parseCommonPrefixesEntity(listBucketResult.CommonPrefixes);
  }
  if (listVersionsResult) {
    if (listVersionsResult.IsTruncated) {
      isTruncated = listVersionsResult.IsTruncated;
    }
    if (listVersionsResult.Version) {
      toArray(listVersionsResult.Version).forEach(content => {
        result.objects.push(formatObjInfo(content));
      });
    }
    if (listVersionsResult.DeleteMarker) {
      toArray(listVersionsResult.DeleteMarker).forEach(content => {
        result.objects.push(formatObjInfo(content, {
          IsDeleteMarker: true
        }));
      });
    }
    if (listVersionsResult.NextKeyMarker) {
      nextVersionKeyMarker = listVersionsResult.NextKeyMarker;
    }
    if (listVersionsResult.NextVersionIdMarker) {
      result.versionIdMarker = listVersionsResult.NextVersionIdMarker;
    }
    parseCommonPrefixesEntity(listVersionsResult.CommonPrefixes);
  }
  result.isTruncated = isTruncated;
  if (isTruncated) {
    result.nextMarker = nextVersionKeyMarker || nextMarker;
  }
  return result;
}

// parse XML response for list objects v2 in a bucket
export function parseListObjectsV2(xml) {
  var result = {
    objects: [],
    isTruncated: false
  };
  var xmlobj = parseXml(xml);
  if (!xmlobj.ListBucketResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListBucketResult"');
  }
  xmlobj = xmlobj.ListBucketResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextContinuationToken) {
    result.nextContinuationToken = xmlobj.NextContinuationToken;
  }
  if (xmlobj.Contents) {
    toArray(xmlobj.Contents).forEach(content => {
      var name = sanitizeObjectKey(toArray(content.Key)[0]);
      var lastModified = new Date(content.LastModified);
      var etag = sanitizeETag(content.ETag);
      var size = content.Size;
      result.objects.push({
        name,
        lastModified,
        etag,
        size
      });
    });
  }
  if (xmlobj.CommonPrefixes) {
    toArray(xmlobj.CommonPrefixes).forEach(commonPrefix => {
      result.objects.push({
        prefix: sanitizeObjectKey(toArray(commonPrefix.Prefix)[0]),
        size: 0
      });
    });
  }
  return result;
}

// parse XML response for list objects v2 with metadata in a bucket
export function parseListObjectsV2WithMetadata(xml) {
  var result = {
    objects: [],
    isTruncated: false
  };
  var xmlobj = parseXml(xml);
  if (!xmlobj.ListBucketResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListBucketResult"');
  }
  xmlobj = xmlobj.ListBucketResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextContinuationToken) {
    result.nextContinuationToken = xmlobj.NextContinuationToken;
  }
  if (xmlobj.Contents) {
    toArray(xmlobj.Contents).forEach(content => {
      var name = sanitizeObjectKey(content.Key);
      var lastModified = new Date(content.LastModified);
      var etag = sanitizeETag(content.ETag);
      var size = content.Size;
      var metadata;
      if (content.UserMetadata != null) {
        metadata = toArray(content.UserMetadata)[0];
      } else {
        metadata = null;
      }
      result.objects.push({
        name,
        lastModified,
        etag,
        size,
        metadata
      });
    });
  }
  if (xmlobj.CommonPrefixes) {
    toArray(xmlobj.CommonPrefixes).forEach(commonPrefix => {
      result.objects.push({
        prefix: sanitizeObjectKey(toArray(commonPrefix.Prefix)[0]),
        size: 0
      });
    });
  }
  return result;
}
export function parseBucketVersioningConfig(xml) {
  var xmlObj = parseXml(xml);
  return xmlObj.VersioningConfiguration;
}
export function parseTagging(xml) {
  const xmlObj = parseXml(xml);
  let result = [];
  if (xmlObj.Tagging && xmlObj.Tagging.TagSet && xmlObj.Tagging.TagSet.Tag) {
    const tagResult = xmlObj.Tagging.TagSet.Tag;
    // if it is a single tag convert into an array so that the return value is always an array.
    if (isObject(tagResult)) {
      result.push(tagResult);
    } else {
      result = tagResult;
    }
  }
  return result;
}
export function parseLifecycleConfig(xml) {
  const xmlObj = parseXml(xml);
  return xmlObj.LifecycleConfiguration;
}
export function parseObjectLockConfig(xml) {
  const xmlObj = parseXml(xml);
  let lockConfigResult = {};
  if (xmlObj.ObjectLockConfiguration) {
    lockConfigResult = {
      objectLockEnabled: xmlObj.ObjectLockConfiguration.ObjectLockEnabled
    };
    let retentionResp;
    if (xmlObj.ObjectLockConfiguration && xmlObj.ObjectLockConfiguration.Rule && xmlObj.ObjectLockConfiguration.Rule.DefaultRetention) {
      retentionResp = xmlObj.ObjectLockConfiguration.Rule.DefaultRetention || {};
      lockConfigResult.mode = retentionResp.Mode;
    }
    if (retentionResp) {
      const isUnitYears = retentionResp.Years;
      if (isUnitYears) {
        lockConfigResult.validity = isUnitYears;
        lockConfigResult.unit = RETENTION_VALIDITY_UNITS.YEARS;
      } else {
        lockConfigResult.validity = retentionResp.Days;
        lockConfigResult.unit = RETENTION_VALIDITY_UNITS.DAYS;
      }
    }
    return lockConfigResult;
  }
}
export function parseObjectRetentionConfig(xml) {
  const xmlObj = parseXml(xml);
  const retentionConfig = xmlObj.Retention;
  return {
    mode: retentionConfig.Mode,
    retainUntilDate: retentionConfig.RetainUntilDate
  };
}
export function parseBucketEncryptionConfig(xml) {
  let encConfig = parseXml(xml);
  return encConfig;
}
export function parseObjectLegalHoldConfig(xml) {
  const xmlObj = parseXml(xml);
  return xmlObj.LegalHold;
}
export function uploadPartParser(xml) {
  const xmlObj = parseXml(xml);
  const respEl = xmlObj.CopyPartResult;
  return respEl;
}
export function removeObjectsParser(xml) {
  const xmlObj = parseXml(xml);
  if (xmlObj.DeleteResult && xmlObj.DeleteResult.Error) {
    // return errors as array always. as the response is object in case of single object passed in removeObjects
    return toArray(xmlObj.DeleteResult.Error);
  }
  return [];
}
export function parseSelectObjectContentResponse(res) {
  // extractHeaderType extracts the first half of the header message, the header type.
  function extractHeaderType(stream) {
    const headerNameLen = Buffer.from(stream.read(1)).readUInt8();
    const headerNameWithSeparator = Buffer.from(stream.read(headerNameLen)).toString();
    const splitBySeparator = (headerNameWithSeparator || '').split(':');
    const headerName = splitBySeparator.length >= 1 ? splitBySeparator[1] : '';
    return headerName;
  }
  function extractHeaderValue(stream) {
    const bodyLen = Buffer.from(stream.read(2)).readUInt16BE();
    const bodyName = Buffer.from(stream.read(bodyLen)).toString();
    return bodyName;
  }
  const selectResults = new SelectResults({}); // will be returned

  const responseStream = readableStream(res); // convert byte array to a readable responseStream
  while (responseStream._readableState.length) {
    // Top level responseStream read tracker.
    let msgCrcAccumulator; // accumulate from start of the message till the message crc start.

    const totalByteLengthBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = crc32(totalByteLengthBuffer);
    const headerBytesBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = crc32(headerBytesBuffer, msgCrcAccumulator);
    const calculatedPreludeCrc = msgCrcAccumulator.readInt32BE(); // use it to check if any CRC mismatch in header itself.

    const preludeCrcBuffer = Buffer.from(responseStream.read(4)); // read 4 bytes    i.e 4+4 =8 + 4 = 12 ( prelude + prelude crc)
    msgCrcAccumulator = crc32(preludeCrcBuffer, msgCrcAccumulator);
    const totalMsgLength = totalByteLengthBuffer.readInt32BE();
    const headerLength = headerBytesBuffer.readInt32BE();
    const preludeCrcByteValue = preludeCrcBuffer.readInt32BE();
    if (preludeCrcByteValue !== calculatedPreludeCrc) {
      // Handle Header CRC mismatch Error
      throw new Error(`Header Checksum Mismatch, Prelude CRC of ${preludeCrcByteValue} does not equal expected CRC of ${calculatedPreludeCrc}`);
    }
    const headers = {};
    if (headerLength > 0) {
      const headerBytes = Buffer.from(responseStream.read(headerLength));
      msgCrcAccumulator = crc32(headerBytes, msgCrcAccumulator);
      const headerReaderStream = readableStream(headerBytes);
      while (headerReaderStream._readableState.length) {
        let headerTypeName = extractHeaderType(headerReaderStream);
        headerReaderStream.read(1); // just read and ignore it.
        headers[headerTypeName] = extractHeaderValue(headerReaderStream);
      }
    }
    let payloadStream;
    const payLoadLength = totalMsgLength - headerLength - 16;
    if (payLoadLength > 0) {
      const payLoadBuffer = Buffer.from(responseStream.read(payLoadLength));
      msgCrcAccumulator = crc32(payLoadBuffer, msgCrcAccumulator);
      // read the checksum early and detect any mismatch so we can avoid unnecessary further processing.
      const messageCrcByteValue = Buffer.from(responseStream.read(4)).readInt32BE();
      const calculatedCrc = msgCrcAccumulator.readInt32BE();
      // Handle message CRC Error
      if (messageCrcByteValue !== calculatedCrc) {
        throw new Error(`Message Checksum Mismatch, Message CRC of ${messageCrcByteValue} does not equal expected CRC of ${calculatedCrc}`);
      }
      payloadStream = readableStream(payLoadBuffer);
    }
    const messageType = headers['message-type'];
    switch (messageType) {
      case 'error':
        {
          const errorMessage = headers['error-code'] + ':"' + headers['error-message'] + '"';
          throw new Error(errorMessage);
        }
      case 'event':
        {
          const contentType = headers['content-type'];
          const eventType = headers['event-type'];
          switch (eventType) {
            case 'End':
              {
                selectResults.setResponse(res);
                return selectResults;
              }
            case 'Records':
              {
                const readData = payloadStream.read(payLoadLength);
                selectResults.setRecords(readData);
                break;
              }
            case 'Progress':
              {
                switch (contentType) {
                  case 'text/xml':
                    {
                      const progressData = payloadStream.read(payLoadLength);
                      selectResults.setProgress(progressData.toString());
                      break;
                    }
                  default:
                    {
                      const errorMessage = `Unexpected content-type ${contentType} sent for event-type Progress`;
                      throw new Error(errorMessage);
                    }
                }
              }
              break;
            case 'Stats':
              {
                switch (contentType) {
                  case 'text/xml':
                    {
                      const statsData = payloadStream.read(payLoadLength);
                      selectResults.setStats(statsData.toString());
                      break;
                    }
                  default:
                    {
                      const errorMessage = `Unexpected content-type ${contentType} sent for event-type Stats`;
                      throw new Error(errorMessage);
                    }
                }
              }
              break;
            default:
              {
                // Continuation message: Not sure if it is supported. did not find a reference or any message in response.
                // It does not have a payload.
                const warningMessage = `Un implemented event detected  ${messageType}.`;
                // eslint-disable-next-line no-console
                console.warn(warningMessage);
              }
          } // eventType End
        }
      // Event End
    } // messageType End
  } // Top Level Stream End
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcmMzMiIsIlhNTFBhcnNlciIsImVycm9ycyIsIlNlbGVjdFJlc3VsdHMiLCJpc09iamVjdCIsInBhcnNlWG1sIiwicmVhZGFibGVTdHJlYW0iLCJzYW5pdGl6ZUVUYWciLCJzYW5pdGl6ZU9iamVjdEtleSIsInNhbml0aXplU2l6ZSIsInRvQXJyYXkiLCJSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMiLCJmeHBXaXRob3V0TnVtUGFyc2VyIiwibnVtYmVyUGFyc2VPcHRpb25zIiwic2tpcExpa2UiLCJwYXJzZUNvcHlPYmplY3QiLCJ4bWwiLCJyZXN1bHQiLCJldGFnIiwibGFzdE1vZGlmaWVkIiwieG1sb2JqIiwiQ29weU9iamVjdFJlc3VsdCIsIkludmFsaWRYTUxFcnJvciIsIkVUYWciLCJyZXBsYWNlIiwiTGFzdE1vZGlmaWVkIiwiRGF0ZSIsInBhcnNlTGlzdE11bHRpcGFydCIsInVwbG9hZHMiLCJwcmVmaXhlcyIsImlzVHJ1bmNhdGVkIiwiTGlzdE11bHRpcGFydFVwbG9hZHNSZXN1bHQiLCJJc1RydW5jYXRlZCIsIk5leHRLZXlNYXJrZXIiLCJuZXh0S2V5TWFya2VyIiwiTmV4dFVwbG9hZElkTWFya2VyIiwibmV4dFVwbG9hZElkTWFya2VyIiwiQ29tbW9uUHJlZml4ZXMiLCJmb3JFYWNoIiwicHJlZml4IiwicHVzaCIsIlByZWZpeCIsIlVwbG9hZCIsInVwbG9hZCIsImtleSIsIktleSIsInVwbG9hZElkIiwiVXBsb2FkSWQiLCJpbml0aWF0b3IiLCJpZCIsIkluaXRpYXRvciIsIklEIiwiZGlzcGxheU5hbWUiLCJEaXNwbGF5TmFtZSIsIm93bmVyIiwiT3duZXIiLCJzdG9yYWdlQ2xhc3MiLCJTdG9yYWdlQ2xhc3MiLCJpbml0aWF0ZWQiLCJJbml0aWF0ZWQiLCJwYXJzZUJ1Y2tldE5vdGlmaWNhdGlvbiIsIlRvcGljQ29uZmlndXJhdGlvbiIsIlF1ZXVlQ29uZmlndXJhdGlvbiIsIkNsb3VkRnVuY3Rpb25Db25maWd1cmF0aW9uIiwiZ2VuRXZlbnRzIiwiZXZlbnRzIiwiczNldmVudCIsImdlbkZpbHRlclJ1bGVzIiwiZmlsdGVycyIsIlMzS2V5IiwiRmlsdGVyUnVsZSIsInJ1bGUiLCJOYW1lIiwiVmFsdWUiLCJOb3RpZmljYXRpb25Db25maWd1cmF0aW9uIiwiY29uZmlnIiwiSWQiLCJUb3BpYyIsIkV2ZW50IiwiRmlsdGVyIiwiUXVldWUiLCJDbG91ZEZ1bmN0aW9uIiwicGFyc2VDb21wbGV0ZU11bHRpcGFydCIsIkNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0IiwiTG9jYXRpb24iLCJsb2NhdGlvbiIsImJ1Y2tldCIsIkJ1Y2tldCIsIkNvZGUiLCJNZXNzYWdlIiwiZXJyQ29kZSIsImVyck1lc3NhZ2UiLCJmb3JtYXRPYmpJbmZvIiwiY29udGVudCIsIm9wdHMiLCJTaXplIiwiVmVyc2lvbklkIiwiSXNMYXRlc3QiLCJuYW1lIiwic2l6ZSIsInZlcnNpb25JZCIsImlzTGF0ZXN0IiwiaXNEZWxldGVNYXJrZXIiLCJJc0RlbGV0ZU1hcmtlciIsInBhcnNlTGlzdE9iamVjdHMiLCJvYmplY3RzIiwibmV4dE1hcmtlciIsIm5leHRWZXJzaW9uS2V5TWFya2VyIiwicGFyc2UiLCJwYXJzZUNvbW1vblByZWZpeGVzRW50aXR5IiwicmVzcG9uc2VFbnRpdHkiLCJjb21tb25QcmVmaXgiLCJsaXN0QnVja2V0UmVzdWx0IiwiTGlzdEJ1Y2tldFJlc3VsdCIsImxpc3RWZXJzaW9uc1Jlc3VsdCIsIkxpc3RWZXJzaW9uc1Jlc3VsdCIsIkNvbnRlbnRzIiwiTmV4dE1hcmtlciIsIlZlcnNpb24iLCJEZWxldGVNYXJrZXIiLCJOZXh0VmVyc2lvbklkTWFya2VyIiwidmVyc2lvbklkTWFya2VyIiwicGFyc2VMaXN0T2JqZWN0c1YyIiwiTmV4dENvbnRpbnVhdGlvblRva2VuIiwibmV4dENvbnRpbnVhdGlvblRva2VuIiwicGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhIiwibWV0YWRhdGEiLCJVc2VyTWV0YWRhdGEiLCJwYXJzZUJ1Y2tldFZlcnNpb25pbmdDb25maWciLCJ4bWxPYmoiLCJWZXJzaW9uaW5nQ29uZmlndXJhdGlvbiIsInBhcnNlVGFnZ2luZyIsIlRhZ2dpbmciLCJUYWdTZXQiLCJUYWciLCJ0YWdSZXN1bHQiLCJwYXJzZUxpZmVjeWNsZUNvbmZpZyIsIkxpZmVjeWNsZUNvbmZpZ3VyYXRpb24iLCJwYXJzZU9iamVjdExvY2tDb25maWciLCJsb2NrQ29uZmlnUmVzdWx0IiwiT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24iLCJvYmplY3RMb2NrRW5hYmxlZCIsIk9iamVjdExvY2tFbmFibGVkIiwicmV0ZW50aW9uUmVzcCIsIlJ1bGUiLCJEZWZhdWx0UmV0ZW50aW9uIiwibW9kZSIsIk1vZGUiLCJpc1VuaXRZZWFycyIsIlllYXJzIiwidmFsaWRpdHkiLCJ1bml0IiwiWUVBUlMiLCJEYXlzIiwiREFZUyIsInBhcnNlT2JqZWN0UmV0ZW50aW9uQ29uZmlnIiwicmV0ZW50aW9uQ29uZmlnIiwiUmV0ZW50aW9uIiwicmV0YWluVW50aWxEYXRlIiwiUmV0YWluVW50aWxEYXRlIiwicGFyc2VCdWNrZXRFbmNyeXB0aW9uQ29uZmlnIiwiZW5jQ29uZmlnIiwicGFyc2VPYmplY3RMZWdhbEhvbGRDb25maWciLCJMZWdhbEhvbGQiLCJ1cGxvYWRQYXJ0UGFyc2VyIiwicmVzcEVsIiwiQ29weVBhcnRSZXN1bHQiLCJyZW1vdmVPYmplY3RzUGFyc2VyIiwiRGVsZXRlUmVzdWx0IiwiRXJyb3IiLCJwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZSIsInJlcyIsImV4dHJhY3RIZWFkZXJUeXBlIiwic3RyZWFtIiwiaGVhZGVyTmFtZUxlbiIsIkJ1ZmZlciIsImZyb20iLCJyZWFkIiwicmVhZFVJbnQ4IiwiaGVhZGVyTmFtZVdpdGhTZXBhcmF0b3IiLCJ0b1N0cmluZyIsInNwbGl0QnlTZXBhcmF0b3IiLCJzcGxpdCIsImhlYWRlck5hbWUiLCJsZW5ndGgiLCJleHRyYWN0SGVhZGVyVmFsdWUiLCJib2R5TGVuIiwicmVhZFVJbnQxNkJFIiwiYm9keU5hbWUiLCJzZWxlY3RSZXN1bHRzIiwicmVzcG9uc2VTdHJlYW0iLCJfcmVhZGFibGVTdGF0ZSIsIm1zZ0NyY0FjY3VtdWxhdG9yIiwidG90YWxCeXRlTGVuZ3RoQnVmZmVyIiwiaGVhZGVyQnl0ZXNCdWZmZXIiLCJjYWxjdWxhdGVkUHJlbHVkZUNyYyIsInJlYWRJbnQzMkJFIiwicHJlbHVkZUNyY0J1ZmZlciIsInRvdGFsTXNnTGVuZ3RoIiwiaGVhZGVyTGVuZ3RoIiwicHJlbHVkZUNyY0J5dGVWYWx1ZSIsImhlYWRlcnMiLCJoZWFkZXJCeXRlcyIsImhlYWRlclJlYWRlclN0cmVhbSIsImhlYWRlclR5cGVOYW1lIiwicGF5bG9hZFN0cmVhbSIsInBheUxvYWRMZW5ndGgiLCJwYXlMb2FkQnVmZmVyIiwibWVzc2FnZUNyY0J5dGVWYWx1ZSIsImNhbGN1bGF0ZWRDcmMiLCJtZXNzYWdlVHlwZSIsImVycm9yTWVzc2FnZSIsImNvbnRlbnRUeXBlIiwiZXZlbnRUeXBlIiwic2V0UmVzcG9uc2UiLCJyZWFkRGF0YSIsInNldFJlY29yZHMiLCJwcm9ncmVzc0RhdGEiLCJzZXRQcm9ncmVzcyIsInN0YXRzRGF0YSIsInNldFN0YXRzIiwid2FybmluZ01lc3NhZ2UiLCJjb25zb2xlIiwid2FybiJdLCJzb3VyY2VzIjpbInhtbC1wYXJzZXJzLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gKiBNaW5JTyBKYXZhc2NyaXB0IExpYnJhcnkgZm9yIEFtYXpvbiBTMyBDb21wYXRpYmxlIENsb3VkIFN0b3JhZ2UsIChDKSAyMDE1IE1pbklPLCBJbmMuXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICovXG5cbmltcG9ydCBjcmMzMiBmcm9tICdidWZmZXItY3JjMzInXG5pbXBvcnQgeyBYTUxQYXJzZXIgfSBmcm9tICdmYXN0LXhtbC1wYXJzZXInXG5cbmltcG9ydCAqIGFzIGVycm9ycyBmcm9tICcuL2Vycm9ycy50cydcbmltcG9ydCB7IFNlbGVjdFJlc3VsdHMgfSBmcm9tICcuL2hlbHBlcnMudHMnXG5pbXBvcnQge1xuICBpc09iamVjdCxcbiAgcGFyc2VYbWwsXG4gIHJlYWRhYmxlU3RyZWFtLFxuICBzYW5pdGl6ZUVUYWcsXG4gIHNhbml0aXplT2JqZWN0S2V5LFxuICBzYW5pdGl6ZVNpemUsXG4gIHRvQXJyYXksXG59IGZyb20gJy4vaW50ZXJuYWwvaGVscGVyLnRzJ1xuaW1wb3J0IHsgUkVURU5USU9OX1ZBTElESVRZX1VOSVRTIH0gZnJvbSAnLi9pbnRlcm5hbC90eXBlLnRzJ1xuXG5jb25zdCBmeHBXaXRob3V0TnVtUGFyc2VyID0gbmV3IFhNTFBhcnNlcih7XG4gIG51bWJlclBhcnNlT3B0aW9uczoge1xuICAgIHNraXBMaWtlOiAvLi8sXG4gIH0sXG59KVxuXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2UgZm9yIGNvcHkgb2JqZWN0XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb3B5T2JqZWN0KHhtbCkge1xuICB2YXIgcmVzdWx0ID0ge1xuICAgIGV0YWc6ICcnLFxuICAgIGxhc3RNb2RpZmllZDogJycsXG4gIH1cblxuICB2YXIgeG1sb2JqID0gcGFyc2VYbWwoeG1sKVxuICBpZiAoIXhtbG9iai5Db3B5T2JqZWN0UmVzdWx0KSB7XG4gICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIkNvcHlPYmplY3RSZXN1bHRcIicpXG4gIH1cbiAgeG1sb2JqID0geG1sb2JqLkNvcHlPYmplY3RSZXN1bHRcbiAgaWYgKHhtbG9iai5FVGFnKSB7XG4gICAgcmVzdWx0LmV0YWcgPSB4bWxvYmouRVRhZy5yZXBsYWNlKC9eXCIvZywgJycpXG4gICAgICAucmVwbGFjZSgvXCIkL2csICcnKVxuICAgICAgLnJlcGxhY2UoL14mcXVvdDsvZywgJycpXG4gICAgICAucmVwbGFjZSgvJnF1b3Q7JC9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC9eJiMzNDsvZywgJycpXG4gICAgICAucmVwbGFjZSgvJiMzNDskL2csICcnKVxuICB9XG4gIGlmICh4bWxvYmouTGFzdE1vZGlmaWVkKSB7XG4gICAgcmVzdWx0Lmxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKHhtbG9iai5MYXN0TW9kaWZpZWQpXG4gIH1cblxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdGluZyBpbi1wcm9ncmVzcyBtdWx0aXBhcnQgdXBsb2Fkc1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlzdE11bHRpcGFydCh4bWwpIHtcbiAgdmFyIHJlc3VsdCA9IHtcbiAgICB1cGxvYWRzOiBbXSxcbiAgICBwcmVmaXhlczogW10sXG4gICAgaXNUcnVuY2F0ZWQ6IGZhbHNlLFxuICB9XG5cbiAgdmFyIHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcblxuICBpZiAoIXhtbG9iai5MaXN0TXVsdGlwYXJ0VXBsb2Fkc1Jlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJMaXN0TXVsdGlwYXJ0VXBsb2Fkc1Jlc3VsdFwiJylcbiAgfVxuICB4bWxvYmogPSB4bWxvYmouTGlzdE11bHRpcGFydFVwbG9hZHNSZXN1bHRcbiAgaWYgKHhtbG9iai5Jc1RydW5jYXRlZCkge1xuICAgIHJlc3VsdC5pc1RydW5jYXRlZCA9IHhtbG9iai5Jc1RydW5jYXRlZFxuICB9XG4gIGlmICh4bWxvYmouTmV4dEtleU1hcmtlcikge1xuICAgIHJlc3VsdC5uZXh0S2V5TWFya2VyID0geG1sb2JqLk5leHRLZXlNYXJrZXJcbiAgfVxuICBpZiAoeG1sb2JqLk5leHRVcGxvYWRJZE1hcmtlcikge1xuICAgIHJlc3VsdC5uZXh0VXBsb2FkSWRNYXJrZXIgPSB4bWxvYmoubmV4dFVwbG9hZElkTWFya2VyIHx8ICcnXG4gIH1cblxuICBpZiAoeG1sb2JqLkNvbW1vblByZWZpeGVzKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ29tbW9uUHJlZml4ZXMpLmZvckVhY2goKHByZWZpeCkgPT4ge1xuICAgICAgcmVzdWx0LnByZWZpeGVzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkocHJlZml4LlByZWZpeClbMF0pIH0pXG4gICAgfSlcbiAgfVxuXG4gIGlmICh4bWxvYmouVXBsb2FkKSB7XG4gICAgdG9BcnJheSh4bWxvYmouVXBsb2FkKS5mb3JFYWNoKCh1cGxvYWQpID0+IHtcbiAgICAgIHZhciBrZXkgPSB1cGxvYWQuS2V5XG4gICAgICB2YXIgdXBsb2FkSWQgPSB1cGxvYWQuVXBsb2FkSWRcbiAgICAgIHZhciBpbml0aWF0b3IgPSB7IGlkOiB1cGxvYWQuSW5pdGlhdG9yLklELCBkaXNwbGF5TmFtZTogdXBsb2FkLkluaXRpYXRvci5EaXNwbGF5TmFtZSB9XG4gICAgICB2YXIgb3duZXIgPSB7IGlkOiB1cGxvYWQuT3duZXIuSUQsIGRpc3BsYXlOYW1lOiB1cGxvYWQuT3duZXIuRGlzcGxheU5hbWUgfVxuICAgICAgdmFyIHN0b3JhZ2VDbGFzcyA9IHVwbG9hZC5TdG9yYWdlQ2xhc3NcbiAgICAgIHZhciBpbml0aWF0ZWQgPSBuZXcgRGF0ZSh1cGxvYWQuSW5pdGlhdGVkKVxuICAgICAgcmVzdWx0LnVwbG9hZHMucHVzaCh7IGtleSwgdXBsb2FkSWQsIGluaXRpYXRvciwgb3duZXIsIHN0b3JhZ2VDbGFzcywgaW5pdGlhdGVkIH0pXG4gICAgfSlcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSB0byBsaXN0IGFsbCB0aGUgb3duZWQgYnVja2V0c1xuXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2UgZm9yIGJ1Y2tldCBub3RpZmljYXRpb25cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUJ1Y2tldE5vdGlmaWNhdGlvbih4bWwpIHtcbiAgdmFyIHJlc3VsdCA9IHtcbiAgICBUb3BpY0NvbmZpZ3VyYXRpb246IFtdLFxuICAgIFF1ZXVlQ29uZmlndXJhdGlvbjogW10sXG4gICAgQ2xvdWRGdW5jdGlvbkNvbmZpZ3VyYXRpb246IFtdLFxuICB9XG4gIC8vIFBhcnNlIHRoZSBldmVudHMgbGlzdFxuICB2YXIgZ2VuRXZlbnRzID0gZnVuY3Rpb24gKGV2ZW50cykge1xuICAgIHZhciByZXN1bHQgPSBbXVxuICAgIGlmIChldmVudHMpIHtcbiAgICAgIHRvQXJyYXkoZXZlbnRzKS5mb3JFYWNoKChzM2V2ZW50KSA9PiB7XG4gICAgICAgIHJlc3VsdC5wdXNoKHMzZXZlbnQpXG4gICAgICB9KVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cbiAgLy8gUGFyc2UgYWxsIGZpbHRlciBydWxlc1xuICB2YXIgZ2VuRmlsdGVyUnVsZXMgPSBmdW5jdGlvbiAoZmlsdGVycykge1xuICAgIHZhciByZXN1bHQgPSBbXVxuICAgIGlmIChmaWx0ZXJzKSB7XG4gICAgICBmaWx0ZXJzID0gdG9BcnJheShmaWx0ZXJzKVxuICAgICAgaWYgKGZpbHRlcnNbMF0uUzNLZXkpIHtcbiAgICAgICAgZmlsdGVyc1swXS5TM0tleSA9IHRvQXJyYXkoZmlsdGVyc1swXS5TM0tleSlcbiAgICAgICAgaWYgKGZpbHRlcnNbMF0uUzNLZXlbMF0uRmlsdGVyUnVsZSkge1xuICAgICAgICAgIHRvQXJyYXkoZmlsdGVyc1swXS5TM0tleVswXS5GaWx0ZXJSdWxlKS5mb3JFYWNoKChydWxlKSA9PiB7XG4gICAgICAgICAgICB2YXIgTmFtZSA9IHRvQXJyYXkocnVsZS5OYW1lKVswXVxuICAgICAgICAgICAgdmFyIFZhbHVlID0gdG9BcnJheShydWxlLlZhbHVlKVswXVxuICAgICAgICAgICAgcmVzdWx0LnB1c2goeyBOYW1lLCBWYWx1ZSB9KVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgdmFyIHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcbiAgeG1sb2JqID0geG1sb2JqLk5vdGlmaWNhdGlvbkNvbmZpZ3VyYXRpb25cblxuICAvLyBQYXJzZSBhbGwgdG9waWMgY29uZmlndXJhdGlvbnMgaW4gdGhlIHhtbFxuICBpZiAoeG1sb2JqLlRvcGljQ29uZmlndXJhdGlvbikge1xuICAgIHRvQXJyYXkoeG1sb2JqLlRvcGljQ29uZmlndXJhdGlvbikuZm9yRWFjaCgoY29uZmlnKSA9PiB7XG4gICAgICB2YXIgSWQgPSB0b0FycmF5KGNvbmZpZy5JZClbMF1cbiAgICAgIHZhciBUb3BpYyA9IHRvQXJyYXkoY29uZmlnLlRvcGljKVswXVxuICAgICAgdmFyIEV2ZW50ID0gZ2VuRXZlbnRzKGNvbmZpZy5FdmVudClcbiAgICAgIHZhciBGaWx0ZXIgPSBnZW5GaWx0ZXJSdWxlcyhjb25maWcuRmlsdGVyKVxuICAgICAgcmVzdWx0LlRvcGljQ29uZmlndXJhdGlvbi5wdXNoKHsgSWQsIFRvcGljLCBFdmVudCwgRmlsdGVyIH0pXG4gICAgfSlcbiAgfVxuICAvLyBQYXJzZSBhbGwgdG9waWMgY29uZmlndXJhdGlvbnMgaW4gdGhlIHhtbFxuICBpZiAoeG1sb2JqLlF1ZXVlQ29uZmlndXJhdGlvbikge1xuICAgIHRvQXJyYXkoeG1sb2JqLlF1ZXVlQ29uZmlndXJhdGlvbikuZm9yRWFjaCgoY29uZmlnKSA9PiB7XG4gICAgICB2YXIgSWQgPSB0b0FycmF5KGNvbmZpZy5JZClbMF1cbiAgICAgIHZhciBRdWV1ZSA9IHRvQXJyYXkoY29uZmlnLlF1ZXVlKVswXVxuICAgICAgdmFyIEV2ZW50ID0gZ2VuRXZlbnRzKGNvbmZpZy5FdmVudClcbiAgICAgIHZhciBGaWx0ZXIgPSBnZW5GaWx0ZXJSdWxlcyhjb25maWcuRmlsdGVyKVxuICAgICAgcmVzdWx0LlF1ZXVlQ29uZmlndXJhdGlvbi5wdXNoKHsgSWQsIFF1ZXVlLCBFdmVudCwgRmlsdGVyIH0pXG4gICAgfSlcbiAgfVxuICAvLyBQYXJzZSBhbGwgUXVldWVDb25maWd1cmF0aW9uIGFycmF5c1xuICBpZiAoeG1sb2JqLkNsb3VkRnVuY3Rpb25Db25maWd1cmF0aW9uKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ2xvdWRGdW5jdGlvbkNvbmZpZ3VyYXRpb24pLmZvckVhY2goKGNvbmZpZykgPT4ge1xuICAgICAgdmFyIElkID0gdG9BcnJheShjb25maWcuSWQpWzBdXG4gICAgICB2YXIgQ2xvdWRGdW5jdGlvbiA9IHRvQXJyYXkoY29uZmlnLkNsb3VkRnVuY3Rpb24pWzBdXG4gICAgICB2YXIgRXZlbnQgPSBnZW5FdmVudHMoY29uZmlnLkV2ZW50KVxuICAgICAgdmFyIEZpbHRlciA9IGdlbkZpbHRlclJ1bGVzKGNvbmZpZy5GaWx0ZXIpXG4gICAgICByZXN1bHQuQ2xvdWRGdW5jdGlvbkNvbmZpZ3VyYXRpb24ucHVzaCh7IElkLCBDbG91ZEZ1bmN0aW9uLCBFdmVudCwgRmlsdGVyIH0pXG4gICAgfSlcbiAgfVxuXG4gIHJldHVybiByZXN1bHRcbn1cblxuLy8gcGFyc2UgWE1MIHJlc3BvbnNlIHdoZW4gYSBtdWx0aXBhcnQgdXBsb2FkIGlzIGNvbXBsZXRlZFxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29tcGxldGVNdWx0aXBhcnQoeG1sKSB7XG4gIHZhciB4bWxvYmogPSBwYXJzZVhtbCh4bWwpLkNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0XG4gIGlmICh4bWxvYmouTG9jYXRpb24pIHtcbiAgICB2YXIgbG9jYXRpb24gPSB0b0FycmF5KHhtbG9iai5Mb2NhdGlvbilbMF1cbiAgICB2YXIgYnVja2V0ID0gdG9BcnJheSh4bWxvYmouQnVja2V0KVswXVxuICAgIHZhciBrZXkgPSB4bWxvYmouS2V5XG4gICAgdmFyIGV0YWcgPSB4bWxvYmouRVRhZy5yZXBsYWNlKC9eXCIvZywgJycpXG4gICAgICAucmVwbGFjZSgvXCIkL2csICcnKVxuICAgICAgLnJlcGxhY2UoL14mcXVvdDsvZywgJycpXG4gICAgICAucmVwbGFjZSgvJnF1b3Q7JC9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC9eJiMzNDsvZywgJycpXG4gICAgICAucmVwbGFjZSgvJiMzNDskL2csICcnKVxuXG4gICAgcmV0dXJuIHsgbG9jYXRpb24sIGJ1Y2tldCwga2V5LCBldGFnIH1cbiAgfVxuICAvLyBDb21wbGV0ZSBNdWx0aXBhcnQgY2FuIHJldHVybiBYTUwgRXJyb3IgYWZ0ZXIgYSAyMDAgT0sgcmVzcG9uc2VcbiAgaWYgKHhtbG9iai5Db2RlICYmIHhtbG9iai5NZXNzYWdlKSB7XG4gICAgdmFyIGVyckNvZGUgPSB0b0FycmF5KHhtbG9iai5Db2RlKVswXVxuICAgIHZhciBlcnJNZXNzYWdlID0gdG9BcnJheSh4bWxvYmouTWVzc2FnZSlbMF1cbiAgICByZXR1cm4geyBlcnJDb2RlLCBlcnJNZXNzYWdlIH1cbiAgfVxufVxuXG5jb25zdCBmb3JtYXRPYmpJbmZvID0gKGNvbnRlbnQsIG9wdHMgPSB7fSkgPT4ge1xuICBsZXQgeyBLZXksIExhc3RNb2RpZmllZCwgRVRhZywgU2l6ZSwgVmVyc2lvbklkLCBJc0xhdGVzdCB9ID0gY29udGVudFxuXG4gIGlmICghaXNPYmplY3Qob3B0cykpIHtcbiAgICBvcHRzID0ge31cbiAgfVxuXG4gIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KEtleSlbMF0pXG4gIGNvbnN0IGxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKHRvQXJyYXkoTGFzdE1vZGlmaWVkKVswXSlcbiAgY29uc3QgZXRhZyA9IHNhbml0aXplRVRhZyh0b0FycmF5KEVUYWcpWzBdKVxuICBjb25zdCBzaXplID0gc2FuaXRpemVTaXplKFNpemUpXG5cbiAgcmV0dXJuIHtcbiAgICBuYW1lLFxuICAgIGxhc3RNb2RpZmllZCxcbiAgICBldGFnLFxuICAgIHNpemUsXG4gICAgdmVyc2lvbklkOiBWZXJzaW9uSWQsXG4gICAgaXNMYXRlc3Q6IElzTGF0ZXN0LFxuICAgIGlzRGVsZXRlTWFya2VyOiBvcHRzLklzRGVsZXRlTWFya2VyID8gb3B0cy5Jc0RlbGV0ZU1hcmtlciA6IGZhbHNlLFxuICB9XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdCBvYmplY3RzIGluIGEgYnVja2V0XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0T2JqZWN0cyh4bWwpIHtcbiAgdmFyIHJlc3VsdCA9IHtcbiAgICBvYmplY3RzOiBbXSxcbiAgICBpc1RydW5jYXRlZDogZmFsc2UsXG4gIH1cbiAgbGV0IGlzVHJ1bmNhdGVkID0gZmFsc2VcbiAgbGV0IG5leHRNYXJrZXIsIG5leHRWZXJzaW9uS2V5TWFya2VyXG4gIGNvbnN0IHhtbG9iaiA9IGZ4cFdpdGhvdXROdW1QYXJzZXIucGFyc2UoeG1sKVxuXG4gIGNvbnN0IHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkgPSAocmVzcG9uc2VFbnRpdHkpID0+IHtcbiAgICBpZiAocmVzcG9uc2VFbnRpdHkpIHtcbiAgICAgIHRvQXJyYXkocmVzcG9uc2VFbnRpdHkpLmZvckVhY2goKGNvbW1vblByZWZpeCkgPT4ge1xuICAgICAgICByZXN1bHQub2JqZWN0cy5wdXNoKHsgcHJlZml4OiBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KGNvbW1vblByZWZpeC5QcmVmaXgpWzBdKSwgc2l6ZTogMCB9KVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICBjb25zdCBsaXN0QnVja2V0UmVzdWx0ID0geG1sb2JqLkxpc3RCdWNrZXRSZXN1bHRcbiAgY29uc3QgbGlzdFZlcnNpb25zUmVzdWx0ID0geG1sb2JqLkxpc3RWZXJzaW9uc1Jlc3VsdFxuXG4gIGlmIChsaXN0QnVja2V0UmVzdWx0KSB7XG4gICAgaWYgKGxpc3RCdWNrZXRSZXN1bHQuSXNUcnVuY2F0ZWQpIHtcbiAgICAgIGlzVHJ1bmNhdGVkID0gbGlzdEJ1Y2tldFJlc3VsdC5Jc1RydW5jYXRlZFxuICAgIH1cbiAgICBpZiAobGlzdEJ1Y2tldFJlc3VsdC5Db250ZW50cykge1xuICAgICAgdG9BcnJheShsaXN0QnVja2V0UmVzdWx0LkNvbnRlbnRzKS5mb3JFYWNoKChjb250ZW50KSA9PiB7XG4gICAgICAgIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KGNvbnRlbnQuS2V5KVswXSlcbiAgICAgICAgY29uc3QgbGFzdE1vZGlmaWVkID0gbmV3IERhdGUodG9BcnJheShjb250ZW50Lkxhc3RNb2RpZmllZClbMF0pXG4gICAgICAgIGNvbnN0IGV0YWcgPSBzYW5pdGl6ZUVUYWcodG9BcnJheShjb250ZW50LkVUYWcpWzBdKVxuICAgICAgICBjb25zdCBzaXplID0gc2FuaXRpemVTaXplKGNvbnRlbnQuU2l6ZSlcbiAgICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IG5hbWUsIGxhc3RNb2RpZmllZCwgZXRhZywgc2l6ZSB9KVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAobGlzdEJ1Y2tldFJlc3VsdC5OZXh0TWFya2VyKSB7XG4gICAgICBuZXh0TWFya2VyID0gbGlzdEJ1Y2tldFJlc3VsdC5OZXh0TWFya2VyXG4gICAgfVxuICAgIHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkobGlzdEJ1Y2tldFJlc3VsdC5Db21tb25QcmVmaXhlcylcbiAgfVxuXG4gIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQpIHtcbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0LklzVHJ1bmNhdGVkKSB7XG4gICAgICBpc1RydW5jYXRlZCA9IGxpc3RWZXJzaW9uc1Jlc3VsdC5Jc1RydW5jYXRlZFxuICAgIH1cblxuICAgIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQuVmVyc2lvbikge1xuICAgICAgdG9BcnJheShsaXN0VmVyc2lvbnNSZXN1bHQuVmVyc2lvbikuZm9yRWFjaCgoY29udGVudCkgPT4ge1xuICAgICAgICByZXN1bHQub2JqZWN0cy5wdXNoKGZvcm1hdE9iakluZm8oY29udGVudCkpXG4gICAgICB9KVxuICAgIH1cbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0LkRlbGV0ZU1hcmtlcikge1xuICAgICAgdG9BcnJheShsaXN0VmVyc2lvbnNSZXN1bHQuRGVsZXRlTWFya2VyKS5mb3JFYWNoKChjb250ZW50KSA9PiB7XG4gICAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goZm9ybWF0T2JqSW5mbyhjb250ZW50LCB7IElzRGVsZXRlTWFya2VyOiB0cnVlIH0pKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0Lk5leHRLZXlNYXJrZXIpIHtcbiAgICAgIG5leHRWZXJzaW9uS2V5TWFya2VyID0gbGlzdFZlcnNpb25zUmVzdWx0Lk5leHRLZXlNYXJrZXJcbiAgICB9XG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5OZXh0VmVyc2lvbklkTWFya2VyKSB7XG4gICAgICByZXN1bHQudmVyc2lvbklkTWFya2VyID0gbGlzdFZlcnNpb25zUmVzdWx0Lk5leHRWZXJzaW9uSWRNYXJrZXJcbiAgICB9XG4gICAgcGFyc2VDb21tb25QcmVmaXhlc0VudGl0eShsaXN0VmVyc2lvbnNSZXN1bHQuQ29tbW9uUHJlZml4ZXMpXG4gIH1cblxuICByZXN1bHQuaXNUcnVuY2F0ZWQgPSBpc1RydW5jYXRlZFxuICBpZiAoaXNUcnVuY2F0ZWQpIHtcbiAgICByZXN1bHQubmV4dE1hcmtlciA9IG5leHRWZXJzaW9uS2V5TWFya2VyIHx8IG5leHRNYXJrZXJcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdCBvYmplY3RzIHYyIGluIGEgYnVja2V0XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0T2JqZWN0c1YyKHhtbCkge1xuICB2YXIgcmVzdWx0ID0ge1xuICAgIG9iamVjdHM6IFtdLFxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcbiAgfVxuICB2YXIgeG1sb2JqID0gcGFyc2VYbWwoeG1sKVxuICBpZiAoIXhtbG9iai5MaXN0QnVja2V0UmVzdWx0KSB7XG4gICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIkxpc3RCdWNrZXRSZXN1bHRcIicpXG4gIH1cbiAgeG1sb2JqID0geG1sb2JqLkxpc3RCdWNrZXRSZXN1bHRcbiAgaWYgKHhtbG9iai5Jc1RydW5jYXRlZCkge1xuICAgIHJlc3VsdC5pc1RydW5jYXRlZCA9IHhtbG9iai5Jc1RydW5jYXRlZFxuICB9XG4gIGlmICh4bWxvYmouTmV4dENvbnRpbnVhdGlvblRva2VuKSB7XG4gICAgcmVzdWx0Lm5leHRDb250aW51YXRpb25Ub2tlbiA9IHhtbG9iai5OZXh0Q29udGludWF0aW9uVG9rZW5cbiAgfVxuICBpZiAoeG1sb2JqLkNvbnRlbnRzKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ29udGVudHMpLmZvckVhY2goKGNvbnRlbnQpID0+IHtcbiAgICAgIHZhciBuYW1lID0gc2FuaXRpemVPYmplY3RLZXkodG9BcnJheShjb250ZW50LktleSlbMF0pXG4gICAgICB2YXIgbGFzdE1vZGlmaWVkID0gbmV3IERhdGUoY29udGVudC5MYXN0TW9kaWZpZWQpXG4gICAgICB2YXIgZXRhZyA9IHNhbml0aXplRVRhZyhjb250ZW50LkVUYWcpXG4gICAgICB2YXIgc2l6ZSA9IGNvbnRlbnQuU2l6ZVxuICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IG5hbWUsIGxhc3RNb2RpZmllZCwgZXRhZywgc2l6ZSB9KVxuICAgIH0pXG4gIH1cbiAgaWYgKHhtbG9iai5Db21tb25QcmVmaXhlcykge1xuICAgIHRvQXJyYXkoeG1sb2JqLkNvbW1vblByZWZpeGVzKS5mb3JFYWNoKChjb21tb25QcmVmaXgpID0+IHtcbiAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkoY29tbW9uUHJlZml4LlByZWZpeClbMF0pLCBzaXplOiAwIH0pXG4gICAgfSlcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdCBvYmplY3RzIHYyIHdpdGggbWV0YWRhdGEgaW4gYSBidWNrZXRcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUxpc3RPYmplY3RzVjJXaXRoTWV0YWRhdGEoeG1sKSB7XG4gIHZhciByZXN1bHQgPSB7XG4gICAgb2JqZWN0czogW10sXG4gICAgaXNUcnVuY2F0ZWQ6IGZhbHNlLFxuICB9XG4gIHZhciB4bWxvYmogPSBwYXJzZVhtbCh4bWwpXG4gIGlmICgheG1sb2JqLkxpc3RCdWNrZXRSZXN1bHQpIHtcbiAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRYTUxFcnJvcignTWlzc2luZyB0YWc6IFwiTGlzdEJ1Y2tldFJlc3VsdFwiJylcbiAgfVxuICB4bWxvYmogPSB4bWxvYmouTGlzdEJ1Y2tldFJlc3VsdFxuICBpZiAoeG1sb2JqLklzVHJ1bmNhdGVkKSB7XG4gICAgcmVzdWx0LmlzVHJ1bmNhdGVkID0geG1sb2JqLklzVHJ1bmNhdGVkXG4gIH1cbiAgaWYgKHhtbG9iai5OZXh0Q29udGludWF0aW9uVG9rZW4pIHtcbiAgICByZXN1bHQubmV4dENvbnRpbnVhdGlvblRva2VuID0geG1sb2JqLk5leHRDb250aW51YXRpb25Ub2tlblxuICB9XG5cbiAgaWYgKHhtbG9iai5Db250ZW50cykge1xuICAgIHRvQXJyYXkoeG1sb2JqLkNvbnRlbnRzKS5mb3JFYWNoKChjb250ZW50KSA9PiB7XG4gICAgICB2YXIgbmFtZSA9IHNhbml0aXplT2JqZWN0S2V5KGNvbnRlbnQuS2V5KVxuICAgICAgdmFyIGxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKGNvbnRlbnQuTGFzdE1vZGlmaWVkKVxuICAgICAgdmFyIGV0YWcgPSBzYW5pdGl6ZUVUYWcoY29udGVudC5FVGFnKVxuICAgICAgdmFyIHNpemUgPSBjb250ZW50LlNpemVcbiAgICAgIHZhciBtZXRhZGF0YVxuICAgICAgaWYgKGNvbnRlbnQuVXNlck1ldGFkYXRhICE9IG51bGwpIHtcbiAgICAgICAgbWV0YWRhdGEgPSB0b0FycmF5KGNvbnRlbnQuVXNlck1ldGFkYXRhKVswXVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWV0YWRhdGEgPSBudWxsXG4gICAgICB9XG4gICAgICByZXN1bHQub2JqZWN0cy5wdXNoKHsgbmFtZSwgbGFzdE1vZGlmaWVkLCBldGFnLCBzaXplLCBtZXRhZGF0YSB9KVxuICAgIH0pXG4gIH1cblxuICBpZiAoeG1sb2JqLkNvbW1vblByZWZpeGVzKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ29tbW9uUHJlZml4ZXMpLmZvckVhY2goKGNvbW1vblByZWZpeCkgPT4ge1xuICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IHByZWZpeDogc2FuaXRpemVPYmplY3RLZXkodG9BcnJheShjb21tb25QcmVmaXguUHJlZml4KVswXSksIHNpemU6IDAgfSlcbiAgICB9KVxuICB9XG4gIHJldHVybiByZXN1bHRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQnVja2V0VmVyc2lvbmluZ0NvbmZpZyh4bWwpIHtcbiAgdmFyIHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcbiAgcmV0dXJuIHhtbE9iai5WZXJzaW9uaW5nQ29uZmlndXJhdGlvblxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VUYWdnaW5nKHhtbCkge1xuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXG4gIGxldCByZXN1bHQgPSBbXVxuICBpZiAoeG1sT2JqLlRhZ2dpbmcgJiYgeG1sT2JqLlRhZ2dpbmcuVGFnU2V0ICYmIHhtbE9iai5UYWdnaW5nLlRhZ1NldC5UYWcpIHtcbiAgICBjb25zdCB0YWdSZXN1bHQgPSB4bWxPYmouVGFnZ2luZy5UYWdTZXQuVGFnXG4gICAgLy8gaWYgaXQgaXMgYSBzaW5nbGUgdGFnIGNvbnZlcnQgaW50byBhbiBhcnJheSBzbyB0aGF0IHRoZSByZXR1cm4gdmFsdWUgaXMgYWx3YXlzIGFuIGFycmF5LlxuICAgIGlmIChpc09iamVjdCh0YWdSZXN1bHQpKSB7XG4gICAgICByZXN1bHQucHVzaCh0YWdSZXN1bHQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdCA9IHRhZ1Jlc3VsdFxuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUxpZmVjeWNsZUNvbmZpZyh4bWwpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICByZXR1cm4geG1sT2JqLkxpZmVjeWNsZUNvbmZpZ3VyYXRpb25cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlT2JqZWN0TG9ja0NvbmZpZyh4bWwpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBsZXQgbG9ja0NvbmZpZ1Jlc3VsdCA9IHt9XG4gIGlmICh4bWxPYmouT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24pIHtcbiAgICBsb2NrQ29uZmlnUmVzdWx0ID0ge1xuICAgICAgb2JqZWN0TG9ja0VuYWJsZWQ6IHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbi5PYmplY3RMb2NrRW5hYmxlZCxcbiAgICB9XG4gICAgbGV0IHJldGVudGlvblJlc3BcbiAgICBpZiAoXG4gICAgICB4bWxPYmouT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24gJiZcbiAgICAgIHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbi5SdWxlICYmXG4gICAgICB4bWxPYmouT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24uUnVsZS5EZWZhdWx0UmV0ZW50aW9uXG4gICAgKSB7XG4gICAgICByZXRlbnRpb25SZXNwID0geG1sT2JqLk9iamVjdExvY2tDb25maWd1cmF0aW9uLlJ1bGUuRGVmYXVsdFJldGVudGlvbiB8fCB7fVxuICAgICAgbG9ja0NvbmZpZ1Jlc3VsdC5tb2RlID0gcmV0ZW50aW9uUmVzcC5Nb2RlXG4gICAgfVxuICAgIGlmIChyZXRlbnRpb25SZXNwKSB7XG4gICAgICBjb25zdCBpc1VuaXRZZWFycyA9IHJldGVudGlvblJlc3AuWWVhcnNcbiAgICAgIGlmIChpc1VuaXRZZWFycykge1xuICAgICAgICBsb2NrQ29uZmlnUmVzdWx0LnZhbGlkaXR5ID0gaXNVbml0WWVhcnNcbiAgICAgICAgbG9ja0NvbmZpZ1Jlc3VsdC51bml0ID0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLllFQVJTXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2NrQ29uZmlnUmVzdWx0LnZhbGlkaXR5ID0gcmV0ZW50aW9uUmVzcC5EYXlzXG4gICAgICAgIGxvY2tDb25maWdSZXN1bHQudW5pdCA9IFJFVEVOVElPTl9WQUxJRElUWV9VTklUUy5EQVlTXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBsb2NrQ29uZmlnUmVzdWx0XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlT2JqZWN0UmV0ZW50aW9uQ29uZmlnKHhtbCkge1xuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXG4gIGNvbnN0IHJldGVudGlvbkNvbmZpZyA9IHhtbE9iai5SZXRlbnRpb25cblxuICByZXR1cm4ge1xuICAgIG1vZGU6IHJldGVudGlvbkNvbmZpZy5Nb2RlLFxuICAgIHJldGFpblVudGlsRGF0ZTogcmV0ZW50aW9uQ29uZmlnLlJldGFpblVudGlsRGF0ZSxcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VCdWNrZXRFbmNyeXB0aW9uQ29uZmlnKHhtbCkge1xuICBsZXQgZW5jQ29uZmlnID0gcGFyc2VYbWwoeG1sKVxuICByZXR1cm4gZW5jQ29uZmlnXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyh4bWwpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICByZXR1cm4geG1sT2JqLkxlZ2FsSG9sZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdXBsb2FkUGFydFBhcnNlcih4bWwpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBjb25zdCByZXNwRWwgPSB4bWxPYmouQ29weVBhcnRSZXN1bHRcbiAgcmV0dXJuIHJlc3BFbFxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlT2JqZWN0c1BhcnNlcih4bWwpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBpZiAoeG1sT2JqLkRlbGV0ZVJlc3VsdCAmJiB4bWxPYmouRGVsZXRlUmVzdWx0LkVycm9yKSB7XG4gICAgLy8gcmV0dXJuIGVycm9ycyBhcyBhcnJheSBhbHdheXMuIGFzIHRoZSByZXNwb25zZSBpcyBvYmplY3QgaW4gY2FzZSBvZiBzaW5nbGUgb2JqZWN0IHBhc3NlZCBpbiByZW1vdmVPYmplY3RzXG4gICAgcmV0dXJuIHRvQXJyYXkoeG1sT2JqLkRlbGV0ZVJlc3VsdC5FcnJvcilcbiAgfVxuICByZXR1cm4gW11cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlKHJlcykge1xuICAvLyBleHRyYWN0SGVhZGVyVHlwZSBleHRyYWN0cyB0aGUgZmlyc3QgaGFsZiBvZiB0aGUgaGVhZGVyIG1lc3NhZ2UsIHRoZSBoZWFkZXIgdHlwZS5cbiAgZnVuY3Rpb24gZXh0cmFjdEhlYWRlclR5cGUoc3RyZWFtKSB7XG4gICAgY29uc3QgaGVhZGVyTmFtZUxlbiA9IEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKDEpKS5yZWFkVUludDgoKVxuICAgIGNvbnN0IGhlYWRlck5hbWVXaXRoU2VwYXJhdG9yID0gQnVmZmVyLmZyb20oc3RyZWFtLnJlYWQoaGVhZGVyTmFtZUxlbikpLnRvU3RyaW5nKClcbiAgICBjb25zdCBzcGxpdEJ5U2VwYXJhdG9yID0gKGhlYWRlck5hbWVXaXRoU2VwYXJhdG9yIHx8ICcnKS5zcGxpdCgnOicpXG4gICAgY29uc3QgaGVhZGVyTmFtZSA9IHNwbGl0QnlTZXBhcmF0b3IubGVuZ3RoID49IDEgPyBzcGxpdEJ5U2VwYXJhdG9yWzFdIDogJydcbiAgICByZXR1cm4gaGVhZGVyTmFtZVxuICB9XG5cbiAgZnVuY3Rpb24gZXh0cmFjdEhlYWRlclZhbHVlKHN0cmVhbSkge1xuICAgIGNvbnN0IGJvZHlMZW4gPSBCdWZmZXIuZnJvbShzdHJlYW0ucmVhZCgyKSkucmVhZFVJbnQxNkJFKClcbiAgICBjb25zdCBib2R5TmFtZSA9IEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKGJvZHlMZW4pKS50b1N0cmluZygpXG4gICAgcmV0dXJuIGJvZHlOYW1lXG4gIH1cblxuICBjb25zdCBzZWxlY3RSZXN1bHRzID0gbmV3IFNlbGVjdFJlc3VsdHMoe30pIC8vIHdpbGwgYmUgcmV0dXJuZWRcblxuICBjb25zdCByZXNwb25zZVN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKHJlcykgLy8gY29udmVydCBieXRlIGFycmF5IHRvIGEgcmVhZGFibGUgcmVzcG9uc2VTdHJlYW1cbiAgd2hpbGUgKHJlc3BvbnNlU3RyZWFtLl9yZWFkYWJsZVN0YXRlLmxlbmd0aCkge1xuICAgIC8vIFRvcCBsZXZlbCByZXNwb25zZVN0cmVhbSByZWFkIHRyYWNrZXIuXG4gICAgbGV0IG1zZ0NyY0FjY3VtdWxhdG9yIC8vIGFjY3VtdWxhdGUgZnJvbSBzdGFydCBvZiB0aGUgbWVzc2FnZSB0aWxsIHRoZSBtZXNzYWdlIGNyYyBzdGFydC5cblxuICAgIGNvbnN0IHRvdGFsQnl0ZUxlbmd0aEJ1ZmZlciA9IEJ1ZmZlci5mcm9tKHJlc3BvbnNlU3RyZWFtLnJlYWQoNCkpXG4gICAgbXNnQ3JjQWNjdW11bGF0b3IgPSBjcmMzMih0b3RhbEJ5dGVMZW5ndGhCdWZmZXIpXG5cbiAgICBjb25zdCBoZWFkZXJCeXRlc0J1ZmZlciA9IEJ1ZmZlci5mcm9tKHJlc3BvbnNlU3RyZWFtLnJlYWQoNCkpXG4gICAgbXNnQ3JjQWNjdW11bGF0b3IgPSBjcmMzMihoZWFkZXJCeXRlc0J1ZmZlciwgbXNnQ3JjQWNjdW11bGF0b3IpXG5cbiAgICBjb25zdCBjYWxjdWxhdGVkUHJlbHVkZUNyYyA9IG1zZ0NyY0FjY3VtdWxhdG9yLnJlYWRJbnQzMkJFKCkgLy8gdXNlIGl0IHRvIGNoZWNrIGlmIGFueSBDUkMgbWlzbWF0Y2ggaW4gaGVhZGVyIGl0c2VsZi5cblxuICAgIGNvbnN0IHByZWx1ZGVDcmNCdWZmZXIgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKDQpKSAvLyByZWFkIDQgYnl0ZXMgICAgaS5lIDQrNCA9OCArIDQgPSAxMiAoIHByZWx1ZGUgKyBwcmVsdWRlIGNyYylcbiAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKHByZWx1ZGVDcmNCdWZmZXIsIG1zZ0NyY0FjY3VtdWxhdG9yKVxuXG4gICAgY29uc3QgdG90YWxNc2dMZW5ndGggPSB0b3RhbEJ5dGVMZW5ndGhCdWZmZXIucmVhZEludDMyQkUoKVxuICAgIGNvbnN0IGhlYWRlckxlbmd0aCA9IGhlYWRlckJ5dGVzQnVmZmVyLnJlYWRJbnQzMkJFKClcbiAgICBjb25zdCBwcmVsdWRlQ3JjQnl0ZVZhbHVlID0gcHJlbHVkZUNyY0J1ZmZlci5yZWFkSW50MzJCRSgpXG5cbiAgICBpZiAocHJlbHVkZUNyY0J5dGVWYWx1ZSAhPT0gY2FsY3VsYXRlZFByZWx1ZGVDcmMpIHtcbiAgICAgIC8vIEhhbmRsZSBIZWFkZXIgQ1JDIG1pc21hdGNoIEVycm9yXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBIZWFkZXIgQ2hlY2tzdW0gTWlzbWF0Y2gsIFByZWx1ZGUgQ1JDIG9mICR7cHJlbHVkZUNyY0J5dGVWYWx1ZX0gZG9lcyBub3QgZXF1YWwgZXhwZWN0ZWQgQ1JDIG9mICR7Y2FsY3VsYXRlZFByZWx1ZGVDcmN9YCxcbiAgICAgIClcbiAgICB9XG5cbiAgICBjb25zdCBoZWFkZXJzID0ge31cbiAgICBpZiAoaGVhZGVyTGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgaGVhZGVyQnl0ZXMgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKGhlYWRlckxlbmd0aCkpXG4gICAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKGhlYWRlckJ5dGVzLCBtc2dDcmNBY2N1bXVsYXRvcilcbiAgICAgIGNvbnN0IGhlYWRlclJlYWRlclN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKGhlYWRlckJ5dGVzKVxuICAgICAgd2hpbGUgKGhlYWRlclJlYWRlclN0cmVhbS5fcmVhZGFibGVTdGF0ZS5sZW5ndGgpIHtcbiAgICAgICAgbGV0IGhlYWRlclR5cGVOYW1lID0gZXh0cmFjdEhlYWRlclR5cGUoaGVhZGVyUmVhZGVyU3RyZWFtKVxuICAgICAgICBoZWFkZXJSZWFkZXJTdHJlYW0ucmVhZCgxKSAvLyBqdXN0IHJlYWQgYW5kIGlnbm9yZSBpdC5cbiAgICAgICAgaGVhZGVyc1toZWFkZXJUeXBlTmFtZV0gPSBleHRyYWN0SGVhZGVyVmFsdWUoaGVhZGVyUmVhZGVyU3RyZWFtKVxuICAgICAgfVxuICAgIH1cblxuICAgIGxldCBwYXlsb2FkU3RyZWFtXG4gICAgY29uc3QgcGF5TG9hZExlbmd0aCA9IHRvdGFsTXNnTGVuZ3RoIC0gaGVhZGVyTGVuZ3RoIC0gMTZcbiAgICBpZiAocGF5TG9hZExlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHBheUxvYWRCdWZmZXIgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKHBheUxvYWRMZW5ndGgpKVxuICAgICAgbXNnQ3JjQWNjdW11bGF0b3IgPSBjcmMzMihwYXlMb2FkQnVmZmVyLCBtc2dDcmNBY2N1bXVsYXRvcilcbiAgICAgIC8vIHJlYWQgdGhlIGNoZWNrc3VtIGVhcmx5IGFuZCBkZXRlY3QgYW55IG1pc21hdGNoIHNvIHdlIGNhbiBhdm9pZCB1bm5lY2Vzc2FyeSBmdXJ0aGVyIHByb2Nlc3NpbmcuXG4gICAgICBjb25zdCBtZXNzYWdlQ3JjQnl0ZVZhbHVlID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZCg0KSkucmVhZEludDMyQkUoKVxuICAgICAgY29uc3QgY2FsY3VsYXRlZENyYyA9IG1zZ0NyY0FjY3VtdWxhdG9yLnJlYWRJbnQzMkJFKClcbiAgICAgIC8vIEhhbmRsZSBtZXNzYWdlIENSQyBFcnJvclxuICAgICAgaWYgKG1lc3NhZ2VDcmNCeXRlVmFsdWUgIT09IGNhbGN1bGF0ZWRDcmMpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIGBNZXNzYWdlIENoZWNrc3VtIE1pc21hdGNoLCBNZXNzYWdlIENSQyBvZiAke21lc3NhZ2VDcmNCeXRlVmFsdWV9IGRvZXMgbm90IGVxdWFsIGV4cGVjdGVkIENSQyBvZiAke2NhbGN1bGF0ZWRDcmN9YCxcbiAgICAgICAgKVxuICAgICAgfVxuICAgICAgcGF5bG9hZFN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKHBheUxvYWRCdWZmZXIpXG4gICAgfVxuXG4gICAgY29uc3QgbWVzc2FnZVR5cGUgPSBoZWFkZXJzWydtZXNzYWdlLXR5cGUnXVxuXG4gICAgc3dpdGNoIChtZXNzYWdlVHlwZSkge1xuICAgICAgY2FzZSAnZXJyb3InOiB7XG4gICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGhlYWRlcnNbJ2Vycm9yLWNvZGUnXSArICc6XCInICsgaGVhZGVyc1snZXJyb3ItbWVzc2FnZSddICsgJ1wiJ1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKVxuICAgICAgfVxuICAgICAgY2FzZSAnZXZlbnQnOiB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gaGVhZGVyc1snY29udGVudC10eXBlJ11cbiAgICAgICAgY29uc3QgZXZlbnRUeXBlID0gaGVhZGVyc1snZXZlbnQtdHlwZSddXG5cbiAgICAgICAgc3dpdGNoIChldmVudFR5cGUpIHtcbiAgICAgICAgICBjYXNlICdFbmQnOiB7XG4gICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFJlc3BvbnNlKHJlcylcbiAgICAgICAgICAgIHJldHVybiBzZWxlY3RSZXN1bHRzXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY2FzZSAnUmVjb3Jkcyc6IHtcbiAgICAgICAgICAgIGNvbnN0IHJlYWREYXRhID0gcGF5bG9hZFN0cmVhbS5yZWFkKHBheUxvYWRMZW5ndGgpXG4gICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFJlY29yZHMocmVhZERhdGEpXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNhc2UgJ1Byb2dyZXNzJzpcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3dpdGNoIChjb250ZW50VHlwZSkge1xuICAgICAgICAgICAgICAgIGNhc2UgJ3RleHQveG1sJzoge1xuICAgICAgICAgICAgICAgICAgY29uc3QgcHJvZ3Jlc3NEYXRhID0gcGF5bG9hZFN0cmVhbS5yZWFkKHBheUxvYWRMZW5ndGgpXG4gICAgICAgICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFByb2dyZXNzKHByb2dyZXNzRGF0YS50b1N0cmluZygpKVxuICAgICAgICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZGVmYXVsdDoge1xuICAgICAgICAgICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gYFVuZXhwZWN0ZWQgY29udGVudC10eXBlICR7Y29udGVudFR5cGV9IHNlbnQgZm9yIGV2ZW50LXR5cGUgUHJvZ3Jlc3NgXG4gICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICBjYXNlICdTdGF0cyc6XG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHN3aXRjaCAoY29udGVudFR5cGUpIHtcbiAgICAgICAgICAgICAgICBjYXNlICd0ZXh0L3htbCc6IHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRzRGF0YSA9IHBheWxvYWRTdHJlYW0ucmVhZChwYXlMb2FkTGVuZ3RoKVxuICAgICAgICAgICAgICAgICAgc2VsZWN0UmVzdWx0cy5zZXRTdGF0cyhzdGF0c0RhdGEudG9TdHJpbmcoKSlcbiAgICAgICAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGBVbmV4cGVjdGVkIGNvbnRlbnQtdHlwZSAke2NvbnRlbnRUeXBlfSBzZW50IGZvciBldmVudC10eXBlIFN0YXRzYFxuICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yTWVzc2FnZSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgZGVmYXVsdDoge1xuICAgICAgICAgICAgLy8gQ29udGludWF0aW9uIG1lc3NhZ2U6IE5vdCBzdXJlIGlmIGl0IGlzIHN1cHBvcnRlZC4gZGlkIG5vdCBmaW5kIGEgcmVmZXJlbmNlIG9yIGFueSBtZXNzYWdlIGluIHJlc3BvbnNlLlxuICAgICAgICAgICAgLy8gSXQgZG9lcyBub3QgaGF2ZSBhIHBheWxvYWQuXG4gICAgICAgICAgICBjb25zdCB3YXJuaW5nTWVzc2FnZSA9IGBVbiBpbXBsZW1lbnRlZCBldmVudCBkZXRlY3RlZCAgJHttZXNzYWdlVHlwZX0uYFxuICAgICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybih3YXJuaW5nTWVzc2FnZSlcbiAgICAgICAgICB9XG4gICAgICAgIH0gLy8gZXZlbnRUeXBlIEVuZFxuICAgICAgfSAvLyBFdmVudCBFbmRcbiAgICB9IC8vIG1lc3NhZ2VUeXBlIEVuZFxuICB9IC8vIFRvcCBMZXZlbCBTdHJlYW0gRW5kXG59XG4iXSwibWFwcGluZ3MiOiJBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxPQUFPQSxLQUFLLE1BQU0sY0FBYztBQUNoQyxTQUFTQyxTQUFTLFFBQVEsaUJBQWlCO0FBRTNDLE9BQU8sS0FBS0MsTUFBTSxNQUFNLGNBQWE7QUFDckMsU0FBU0MsYUFBYSxRQUFRLGVBQWM7QUFDNUMsU0FDRUMsUUFBUSxFQUNSQyxRQUFRLEVBQ1JDLGNBQWMsRUFDZEMsWUFBWSxFQUNaQyxpQkFBaUIsRUFDakJDLFlBQVksRUFDWkMsT0FBTyxRQUNGLHVCQUFzQjtBQUM3QixTQUFTQyx3QkFBd0IsUUFBUSxxQkFBb0I7QUFFN0QsTUFBTUMsbUJBQW1CLEdBQUcsSUFBSVgsU0FBUyxDQUFDO0VBQ3hDWSxrQkFBa0IsRUFBRTtJQUNsQkMsUUFBUSxFQUFFO0VBQ1o7QUFDRixDQUFDLENBQUM7O0FBRUY7QUFDQSxPQUFPLFNBQVNDLGVBQWVBLENBQUNDLEdBQUcsRUFBRTtFQUNuQyxJQUFJQyxNQUFNLEdBQUc7SUFDWEMsSUFBSSxFQUFFLEVBQUU7SUFDUkMsWUFBWSxFQUFFO0VBQ2hCLENBQUM7RUFFRCxJQUFJQyxNQUFNLEdBQUdmLFFBQVEsQ0FBQ1csR0FBRyxDQUFDO0VBQzFCLElBQUksQ0FBQ0ksTUFBTSxDQUFDQyxnQkFBZ0IsRUFBRTtJQUM1QixNQUFNLElBQUluQixNQUFNLENBQUNvQixlQUFlLENBQUMsaUNBQWlDLENBQUM7RUFDckU7RUFDQUYsTUFBTSxHQUFHQSxNQUFNLENBQUNDLGdCQUFnQjtFQUNoQyxJQUFJRCxNQUFNLENBQUNHLElBQUksRUFBRTtJQUNmTixNQUFNLENBQUNDLElBQUksR0FBR0UsTUFBTSxDQUFDRyxJQUFJ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