"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.parseBucketEncryptionConfig = parseBucketEncryptionConfig;
exports.parseBucketNotification = parseBucketNotification;
exports.parseBucketVersioningConfig = parseBucketVersioningConfig;
exports.parseCompleteMultipart = parseCompleteMultipart;
exports.parseCopyObject = parseCopyObject;
exports.parseLifecycleConfig = parseLifecycleConfig;
exports.parseListMultipart = parseListMultipart;
exports.parseListObjects = parseListObjects;
exports.parseListObjectsV2 = parseListObjectsV2;
exports.parseListObjectsV2WithMetadata = parseListObjectsV2WithMetadata;
exports.parseObjectLegalHoldConfig = parseObjectLegalHoldConfig;
exports.parseObjectLockConfig = parseObjectLockConfig;
exports.parseObjectRetentionConfig = parseObjectRetentionConfig;
exports.parseSelectObjectContentResponse = parseSelectObjectContentResponse;
exports.parseTagging = parseTagging;
exports.removeObjectsParser = removeObjectsParser;
exports.uploadPartParser = uploadPartParser;
var _bufferCrc = require("buffer-crc32");
var _fastXmlParser = require("fast-xml-parser");
var errors = _interopRequireWildcard(require("./errors.js"), true);
var _helpers = require("./helpers.js");
var _helper = require("./internal/helper.js");
var _type = require("./internal/type.js");
function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function (nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }
function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }
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

const fxpWithoutNumParser = new _fastXmlParser.XMLParser({
  numberParseOptions: {
    skipLike: /./
  }
});

// parse XML response for copy object
function parseCopyObject(xml) {
  var result = {
    etag: '',
    lastModified: ''
  };
  var xmlobj = (0, _helper.parseXml)(xml);
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
function parseListMultipart(xml) {
  var result = {
    uploads: [],
    prefixes: [],
    isTruncated: false
  };
  var xmlobj = (0, _helper.parseXml)(xml);
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
    (0, _helper.toArray)(xmlobj.CommonPrefixes).forEach(prefix => {
      result.prefixes.push({
        prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(prefix.Prefix)[0])
      });
    });
  }
  if (xmlobj.Upload) {
    (0, _helper.toArray)(xmlobj.Upload).forEach(upload => {
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
function parseBucketNotification(xml) {
  var result = {
    TopicConfiguration: [],
    QueueConfiguration: [],
    CloudFunctionConfiguration: []
  };
  // Parse the events list
  var genEvents = function (events) {
    var result = [];
    if (events) {
      (0, _helper.toArray)(events).forEach(s3event => {
        result.push(s3event);
      });
    }
    return result;
  };
  // Parse all filter rules
  var genFilterRules = function (filters) {
    var result = [];
    if (filters) {
      filters = (0, _helper.toArray)(filters);
      if (filters[0].S3Key) {
        filters[0].S3Key = (0, _helper.toArray)(filters[0].S3Key);
        if (filters[0].S3Key[0].FilterRule) {
          (0, _helper.toArray)(filters[0].S3Key[0].FilterRule).forEach(rule => {
            var Name = (0, _helper.toArray)(rule.Name)[0];
            var Value = (0, _helper.toArray)(rule.Value)[0];
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
  var xmlobj = (0, _helper.parseXml)(xml);
  xmlobj = xmlobj.NotificationConfiguration;

  // Parse all topic configurations in the xml
  if (xmlobj.TopicConfiguration) {
    (0, _helper.toArray)(xmlobj.TopicConfiguration).forEach(config => {
      var Id = (0, _helper.toArray)(config.Id)[0];
      var Topic = (0, _helper.toArray)(config.Topic)[0];
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
    (0, _helper.toArray)(xmlobj.QueueConfiguration).forEach(config => {
      var Id = (0, _helper.toArray)(config.Id)[0];
      var Queue = (0, _helper.toArray)(config.Queue)[0];
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
    (0, _helper.toArray)(xmlobj.CloudFunctionConfiguration).forEach(config => {
      var Id = (0, _helper.toArray)(config.Id)[0];
      var CloudFunction = (0, _helper.toArray)(config.CloudFunction)[0];
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
function parseCompleteMultipart(xml) {
  var xmlobj = (0, _helper.parseXml)(xml).CompleteMultipartUploadResult;
  if (xmlobj.Location) {
    var location = (0, _helper.toArray)(xmlobj.Location)[0];
    var bucket = (0, _helper.toArray)(xmlobj.Bucket)[0];
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
    var errCode = (0, _helper.toArray)(xmlobj.Code)[0];
    var errMessage = (0, _helper.toArray)(xmlobj.Message)[0];
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
  if (!(0, _helper.isObject)(opts)) {
    opts = {};
  }
  const name = (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(Key)[0]);
  const lastModified = new Date((0, _helper.toArray)(LastModified)[0]);
  const etag = (0, _helper.sanitizeETag)((0, _helper.toArray)(ETag)[0]);
  const size = (0, _helper.sanitizeSize)(Size);
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
function parseListObjects(xml) {
  var result = {
    objects: [],
    isTruncated: false
  };
  let isTruncated = false;
  let nextMarker, nextVersionKeyMarker;
  const xmlobj = fxpWithoutNumParser.parse(xml);
  const parseCommonPrefixesEntity = responseEntity => {
    if (responseEntity) {
      (0, _helper.toArray)(responseEntity).forEach(commonPrefix => {
        result.objects.push({
          prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(commonPrefix.Prefix)[0]),
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
      (0, _helper.toArray)(listBucketResult.Contents).forEach(content => {
        const name = (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(content.Key)[0]);
        const lastModified = new Date((0, _helper.toArray)(content.LastModified)[0]);
        const etag = (0, _helper.sanitizeETag)((0, _helper.toArray)(content.ETag)[0]);
        const size = (0, _helper.sanitizeSize)(content.Size);
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
      (0, _helper.toArray)(listVersionsResult.Version).forEach(content => {
        result.objects.push(formatObjInfo(content));
      });
    }
    if (listVersionsResult.DeleteMarker) {
      (0, _helper.toArray)(listVersionsResult.DeleteMarker).forEach(content => {
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
function parseListObjectsV2(xml) {
  var result = {
    objects: [],
    isTruncated: false
  };
  var xmlobj = (0, _helper.parseXml)(xml);
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
    (0, _helper.toArray)(xmlobj.Contents).forEach(content => {
      var name = (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(content.Key)[0]);
      var lastModified = new Date(content.LastModified);
      var etag = (0, _helper.sanitizeETag)(content.ETag);
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
    (0, _helper.toArray)(xmlobj.CommonPrefixes).forEach(commonPrefix => {
      result.objects.push({
        prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(commonPrefix.Prefix)[0]),
        size: 0
      });
    });
  }
  return result;
}

// parse XML response for list objects v2 with metadata in a bucket
function parseListObjectsV2WithMetadata(xml) {
  var result = {
    objects: [],
    isTruncated: false
  };
  var xmlobj = (0, _helper.parseXml)(xml);
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
    (0, _helper.toArray)(xmlobj.Contents).forEach(content => {
      var name = (0, _helper.sanitizeObjectKey)(content.Key);
      var lastModified = new Date(content.LastModified);
      var etag = (0, _helper.sanitizeETag)(content.ETag);
      var size = content.Size;
      var metadata;
      if (content.UserMetadata != null) {
        metadata = (0, _helper.toArray)(content.UserMetadata)[0];
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
    (0, _helper.toArray)(xmlobj.CommonPrefixes).forEach(commonPrefix => {
      result.objects.push({
        prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(commonPrefix.Prefix)[0]),
        size: 0
      });
    });
  }
  return result;
}
function parseBucketVersioningConfig(xml) {
  var xmlObj = (0, _helper.parseXml)(xml);
  return xmlObj.VersioningConfiguration;
}
function parseTagging(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  let result = [];
  if (xmlObj.Tagging && xmlObj.Tagging.TagSet && xmlObj.Tagging.TagSet.Tag) {
    const tagResult = xmlObj.Tagging.TagSet.Tag;
    // if it is a single tag convert into an array so that the return value is always an array.
    if ((0, _helper.isObject)(tagResult)) {
      result.push(tagResult);
    } else {
      result = tagResult;
    }
  }
  return result;
}
function parseLifecycleConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  return xmlObj.LifecycleConfiguration;
}
function parseObjectLockConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
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
        lockConfigResult.unit = _type.RETENTION_VALIDITY_UNITS.YEARS;
      } else {
        lockConfigResult.validity = retentionResp.Days;
        lockConfigResult.unit = _type.RETENTION_VALIDITY_UNITS.DAYS;
      }
    }
    return lockConfigResult;
  }
}
function parseObjectRetentionConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  const retentionConfig = xmlObj.Retention;
  return {
    mode: retentionConfig.Mode,
    retainUntilDate: retentionConfig.RetainUntilDate
  };
}
function parseBucketEncryptionConfig(xml) {
  let encConfig = (0, _helper.parseXml)(xml);
  return encConfig;
}
function parseObjectLegalHoldConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  return xmlObj.LegalHold;
}
function uploadPartParser(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  const respEl = xmlObj.CopyPartResult;
  return respEl;
}
function removeObjectsParser(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  if (xmlObj.DeleteResult && xmlObj.DeleteResult.Error) {
    // return errors as array always. as the response is object in case of single object passed in removeObjects
    return (0, _helper.toArray)(xmlObj.DeleteResult.Error);
  }
  return [];
}
function parseSelectObjectContentResponse(res) {
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
  const selectResults = new _helpers.SelectResults({}); // will be returned

  const responseStream = (0, _helper.readableStream)(res); // convert byte array to a readable responseStream
  while (responseStream._readableState.length) {
    // Top level responseStream read tracker.
    let msgCrcAccumulator; // accumulate from start of the message till the message crc start.

    const totalByteLengthBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = _bufferCrc(totalByteLengthBuffer);
    const headerBytesBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = _bufferCrc(headerBytesBuffer, msgCrcAccumulator);
    const calculatedPreludeCrc = msgCrcAccumulator.readInt32BE(); // use it to check if any CRC mismatch in header itself.

    const preludeCrcBuffer = Buffer.from(responseStream.read(4)); // read 4 bytes    i.e 4+4 =8 + 4 = 12 ( prelude + prelude crc)
    msgCrcAccumulator = _bufferCrc(preludeCrcBuffer, msgCrcAccumulator);
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
      msgCrcAccumulator = _bufferCrc(headerBytes, msgCrcAccumulator);
      const headerReaderStream = (0, _helper.readableStream)(headerBytes);
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
      msgCrcAccumulator = _bufferCrc(payLoadBuffer, msgCrcAccumulator);
      // read the checksum early and detect any mismatch so we can avoid unnecessary further processing.
      const messageCrcByteValue = Buffer.from(responseStream.read(4)).readInt32BE();
      const calculatedCrc = msgCrcAccumulator.readInt32BE();
      // Handle message CRC Error
      if (messageCrcByteValue !== calculatedCrc) {
        throw new Error(`Message Checksum Mismatch, Message CRC of ${messageCrcByteValue} does not equal expected CRC of ${calculatedCrc}`);
      }
      payloadStream = (0, _helper.readableStream)(payLoadBuffer);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfYnVmZmVyQ3JjIiwicmVxdWlyZSIsIl9mYXN0WG1sUGFyc2VyIiwiZXJyb3JzIiwiX2ludGVyb3BSZXF1aXJlV2lsZGNhcmQiLCJfaGVscGVycyIsIl9oZWxwZXIiLCJfdHlwZSIsIl9nZXRSZXF1aXJlV2lsZGNhcmRDYWNoZSIsIm5vZGVJbnRlcm9wIiwiV2Vha01hcCIsImNhY2hlQmFiZWxJbnRlcm9wIiwiY2FjaGVOb2RlSW50ZXJvcCIsIm9iaiIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiY2FjaGUiLCJoYXMiLCJnZXQiLCJuZXdPYmoiLCJoYXNQcm9wZXJ0eURlc2NyaXB0b3IiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsImdldE93blByb3BlcnR5RGVzY3JpcHRvciIsImtleSIsInByb3RvdHlwZSIsImhhc093blByb3BlcnR5IiwiY2FsbCIsImRlc2MiLCJzZXQiLCJmeHBXaXRob3V0TnVtUGFyc2VyIiwiWE1MUGFyc2VyIiwibnVtYmVyUGFyc2VPcHRpb25zIiwic2tpcExpa2UiLCJwYXJzZUNvcHlPYmplY3QiLCJ4bWwiLCJyZXN1bHQiLCJldGFnIiwibGFzdE1vZGlmaWVkIiwieG1sb2JqIiwicGFyc2VYbWwiLCJDb3B5T2JqZWN0UmVzdWx0IiwiSW52YWxpZFhNTEVycm9yIiwiRVRhZyIsInJlcGxhY2UiLCJMYXN0TW9kaWZpZWQiLCJEYXRlIiwicGFyc2VMaXN0TXVsdGlwYXJ0IiwidXBsb2FkcyIsInByZWZpeGVzIiwiaXNUcnVuY2F0ZWQiLCJMaXN0TXVsdGlwYXJ0VXBsb2Fkc1Jlc3VsdCIsIklzVHJ1bmNhdGVkIiwiTmV4dEtleU1hcmtlciIsIm5leHRLZXlNYXJrZXIiLCJOZXh0VXBsb2FkSWRNYXJrZXIiLCJuZXh0VXBsb2FkSWRNYXJrZXIiLCJDb21tb25QcmVmaXhlcyIsInRvQXJyYXkiLCJmb3JFYWNoIiwicHJlZml4IiwicHVzaCIsInNhbml0aXplT2JqZWN0S2V5IiwiUHJlZml4IiwiVXBsb2FkIiwidXBsb2FkIiwiS2V5IiwidXBsb2FkSWQiLCJVcGxvYWRJZCIsImluaXRpYXRvciIsImlkIiwiSW5pdGlhdG9yIiwiSUQiLCJkaXNwbGF5TmFtZSIsIkRpc3BsYXlOYW1lIiwib3duZXIiLCJPd25lciIsInN0b3JhZ2VDbGFzcyIsIlN0b3JhZ2VDbGFzcyIsImluaXRpYXRlZCIsIkluaXRpYXRlZCIsInBhcnNlQnVja2V0Tm90aWZpY2F0aW9uIiwiVG9waWNDb25maWd1cmF0aW9uIiwiUXVldWVDb25maWd1cmF0aW9uIiwiQ2xvdWRGdW5jdGlvbkNvbmZpZ3VyYXRpb24iLCJnZW5FdmVudHMiLCJldmVudHMiLCJzM2V2ZW50IiwiZ2VuRmlsdGVyUnVsZXMiLCJmaWx0ZXJzIiwiUzNLZXkiLCJGaWx0ZXJSdWxlIiwicnVsZSIsIk5hbWUiLCJWYWx1ZSIsIk5vdGlmaWNhdGlvbkNvbmZpZ3VyYXRpb24iLCJjb25maWciLCJJZCIsIlRvcGljIiwiRXZlbnQiLCJGaWx0ZXIiLCJRdWV1ZSIsIkNsb3VkRnVuY3Rpb24iLCJwYXJzZUNvbXBsZXRlTXVsdGlwYXJ0IiwiQ29tcGxldGVNdWx0aXBhcnRVcGxvYWRSZXN1bHQiLCJMb2NhdGlvbiIsImxvY2F0aW9uIiwiYnVja2V0IiwiQnVja2V0IiwiQ29kZSIsIk1lc3NhZ2UiLCJlcnJDb2RlIiwiZXJyTWVzc2FnZSIsImZvcm1hdE9iakluZm8iLCJjb250ZW50Iiwib3B0cyIsIlNpemUiLCJWZXJzaW9uSWQiLCJJc0xhdGVzdCIsImlzT2JqZWN0IiwibmFtZSIsInNhbml0aXplRVRhZyIsInNpemUiLCJzYW5pdGl6ZVNpemUiLCJ2ZXJzaW9uSWQiLCJpc0xhdGVzdCIsImlzRGVsZXRlTWFya2VyIiwiSXNEZWxldGVNYXJrZXIiLCJwYXJzZUxpc3RPYmplY3RzIiwib2JqZWN0cyIsIm5leHRNYXJrZXIiLCJuZXh0VmVyc2lvbktleU1hcmtlciIsInBhcnNlIiwicGFyc2VDb21tb25QcmVmaXhlc0VudGl0eSIsInJlc3BvbnNlRW50aXR5IiwiY29tbW9uUHJlZml4IiwibGlzdEJ1Y2tldFJlc3VsdCIsIkxpc3RCdWNrZXRSZXN1bHQiLCJsaXN0VmVyc2lvbnNSZXN1bHQiLCJMaXN0VmVyc2lvbnNSZXN1bHQiLCJDb250ZW50cyIsIk5leHRNYXJrZXIiLCJWZXJzaW9uIiwiRGVsZXRlTWFya2VyIiwiTmV4dFZlcnNpb25JZE1hcmtlciIsInZlcnNpb25JZE1hcmtlciIsInBhcnNlTGlzdE9iamVjdHNWMiIsIk5leHRDb250aW51YXRpb25Ub2tlbiIsIm5leHRDb250aW51YXRpb25Ub2tlbiIsInBhcnNlTGlzdE9iamVjdHNWMldpdGhNZXRhZGF0YSIsIm1ldGFkYXRhIiwiVXNlck1ldGFkYXRhIiwicGFyc2VCdWNrZXRWZXJzaW9uaW5nQ29uZmlnIiwieG1sT2JqIiwiVmVyc2lvbmluZ0NvbmZpZ3VyYXRpb24iLCJwYXJzZVRhZ2dpbmciLCJUYWdnaW5nIiwiVGFnU2V0IiwiVGFnIiwidGFnUmVzdWx0IiwicGFyc2VMaWZlY3ljbGVDb25maWciLCJMaWZlY3ljbGVDb25maWd1cmF0aW9uIiwicGFyc2VPYmplY3RMb2NrQ29uZmlnIiwibG9ja0NvbmZpZ1Jlc3VsdCIsIk9iamVjdExvY2tDb25maWd1cmF0aW9uIiwib2JqZWN0TG9ja0VuYWJsZWQiLCJPYmplY3RMb2NrRW5hYmxlZCIsInJldGVudGlvblJlc3AiLCJSdWxlIiwiRGVmYXVsdFJldGVudGlvbiIsIm1vZGUiLCJNb2RlIiwiaXNVbml0WWVhcnMiLCJZZWFycyIsInZhbGlkaXR5IiwidW5pdCIsIlJFVEVOVElPTl9WQUxJRElUWV9VTklUUyIsIllFQVJTIiwiRGF5cyIsIkRBWVMiLCJwYXJzZU9iamVjdFJldGVudGlvbkNvbmZpZyIsInJldGVudGlvbkNvbmZpZyIsIlJldGVudGlvbiIsInJldGFpblVudGlsRGF0ZSIsIlJldGFpblVudGlsRGF0ZSIsInBhcnNlQnVja2V0RW5jcnlwdGlvbkNvbmZpZyIsImVuY0NvbmZpZyIsInBhcnNlT2JqZWN0TGVnYWxIb2xkQ29uZmlnIiwiTGVnYWxIb2xkIiwidXBsb2FkUGFydFBhcnNlciIsInJlc3BFbCIsIkNvcHlQYXJ0UmVzdWx0IiwicmVtb3ZlT2JqZWN0c1BhcnNlciIsIkRlbGV0ZVJlc3VsdCIsIkVycm9yIiwicGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UiLCJyZXMiLCJleHRyYWN0SGVhZGVyVHlwZSIsInN0cmVhbSIsImhlYWRlck5hbWVMZW4iLCJCdWZmZXIiLCJmcm9tIiwicmVhZCIsInJlYWRVSW50OCIsImhlYWRlck5hbWVXaXRoU2VwYXJhdG9yIiwidG9TdHJpbmciLCJzcGxpdEJ5U2VwYXJhdG9yIiwic3BsaXQiLCJoZWFkZXJOYW1lIiwibGVuZ3RoIiwiZXh0cmFjdEhlYWRlclZhbHVlIiwiYm9keUxlbiIsInJlYWRVSW50MTZCRSIsImJvZHlOYW1lIiwic2VsZWN0UmVzdWx0cyIsIlNlbGVjdFJlc3VsdHMiLCJyZXNwb25zZVN0cmVhbSIsInJlYWRhYmxlU3RyZWFtIiwiX3JlYWRhYmxlU3RhdGUiLCJtc2dDcmNBY2N1bXVsYXRvciIsInRvdGFsQnl0ZUxlbmd0aEJ1ZmZlciIsImNyYzMyIiwiaGVhZGVyQnl0ZXNCdWZmZXIiLCJjYWxjdWxhdGVkUHJlbHVkZUNyYyIsInJlYWRJbnQzMkJFIiwicHJlbHVkZUNyY0J1ZmZlciIsInRvdGFsTXNnTGVuZ3RoIiwiaGVhZGVyTGVuZ3RoIiwicHJlbHVkZUNyY0J5dGVWYWx1ZSIsImhlYWRlcnMiLCJoZWFkZXJCeXRlcyIsImhlYWRlclJlYWRlclN0cmVhbSIsImhlYWRlclR5cGVOYW1lIiwicGF5bG9hZFN0cmVhbSIsInBheUxvYWRMZW5ndGgiLCJwYXlMb2FkQnVmZmVyIiwibWVzc2FnZUNyY0J5dGVWYWx1ZSIsImNhbGN1bGF0ZWRDcmMiLCJtZXNzYWdlVHlwZSIsImVycm9yTWVzc2FnZSIsImNvbnRlbnRUeXBlIiwiZXZlbnRUeXBlIiwic2V0UmVzcG9uc2UiLCJyZWFkRGF0YSIsInNldFJlY29yZHMiLCJwcm9ncmVzc0RhdGEiLCJzZXRQcm9ncmVzcyIsInN0YXRzRGF0YSIsInNldFN0YXRzIiwid2FybmluZ01lc3NhZ2UiLCJjb25zb2xlIiwid2FybiJdLCJzb3VyY2VzIjpbInhtbC1wYXJzZXJzLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gKiBNaW5JTyBKYXZhc2NyaXB0IExpYnJhcnkgZm9yIEFtYXpvbiBTMyBDb21wYXRpYmxlIENsb3VkIFN0b3JhZ2UsIChDKSAyMDE1IE1pbklPLCBJbmMuXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICovXG5cbmltcG9ydCBjcmMzMiBmcm9tICdidWZmZXItY3JjMzInXG5pbXBvcnQgeyBYTUxQYXJzZXIgfSBmcm9tICdmYXN0LXhtbC1wYXJzZXInXG5cbmltcG9ydCAqIGFzIGVycm9ycyBmcm9tICcuL2Vycm9ycy50cydcbmltcG9ydCB7IFNlbGVjdFJlc3VsdHMgfSBmcm9tICcuL2hlbHBlcnMudHMnXG5pbXBvcnQge1xuICBpc09iamVjdCxcbiAgcGFyc2VYbWwsXG4gIHJlYWRhYmxlU3RyZWFtLFxuICBzYW5pdGl6ZUVUYWcsXG4gIHNhbml0aXplT2JqZWN0S2V5LFxuICBzYW5pdGl6ZVNpemUsXG4gIHRvQXJyYXksXG59IGZyb20gJy4vaW50ZXJuYWwvaGVscGVyLnRzJ1xuaW1wb3J0IHsgUkVURU5USU9OX1ZBTElESVRZX1VOSVRTIH0gZnJvbSAnLi9pbnRlcm5hbC90eXBlLnRzJ1xuXG5jb25zdCBmeHBXaXRob3V0TnVtUGFyc2VyID0gbmV3IFhNTFBhcnNlcih7XG4gIG51bWJlclBhcnNlT3B0aW9uczoge1xuICAgIHNraXBMaWtlOiAvLi8sXG4gIH0sXG59KVxuXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2UgZm9yIGNvcHkgb2JqZWN0XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb3B5T2JqZWN0KHhtbCkge1xuICB2YXIgcmVzdWx0ID0ge1xuICAgIGV0YWc6ICcnLFxuICAgIGxhc3RNb2RpZmllZDogJycsXG4gIH1cblxuICB2YXIgeG1sb2JqID0gcGFyc2VYbWwoeG1sKVxuICBpZiAoIXhtbG9iai5Db3B5T2JqZWN0UmVzdWx0KSB7XG4gICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIkNvcHlPYmplY3RSZXN1bHRcIicpXG4gIH1cbiAgeG1sb2JqID0geG1sb2JqLkNvcHlPYmplY3RSZXN1bHRcbiAgaWYgKHhtbG9iai5FVGFnKSB7XG4gICAgcmVzdWx0LmV0YWcgPSB4bWxvYmouRVRhZy5yZXBsYWNlKC9eXCIvZywgJycpXG4gICAgICAucmVwbGFjZSgvXCIkL2csICcnKVxuICAgICAgLnJlcGxhY2UoL14mcXVvdDsvZywgJycpXG4gICAgICAucmVwbGFjZSgvJnF1b3Q7JC9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC9eJiMzNDsvZywgJycpXG4gICAgICAucmVwbGFjZSgvJiMzNDskL2csICcnKVxuICB9XG4gIGlmICh4bWxvYmouTGFzdE1vZGlmaWVkKSB7XG4gICAgcmVzdWx0Lmxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKHhtbG9iai5MYXN0TW9kaWZpZWQpXG4gIH1cblxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdGluZyBpbi1wcm9ncmVzcyBtdWx0aXBhcnQgdXBsb2Fkc1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlzdE11bHRpcGFydCh4bWwpIHtcbiAgdmFyIHJlc3VsdCA9IHtcbiAgICB1cGxvYWRzOiBbXSxcbiAgICBwcmVmaXhlczogW10sXG4gICAgaXNUcnVuY2F0ZWQ6IGZhbHNlLFxuICB9XG5cbiAgdmFyIHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcblxuICBpZiAoIXhtbG9iai5MaXN0TXVsdGlwYXJ0VXBsb2Fkc1Jlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJMaXN0TXVsdGlwYXJ0VXBsb2Fkc1Jlc3VsdFwiJylcbiAgfVxuICB4bWxvYmogPSB4bWxvYmouTGlzdE11bHRpcGFydFVwbG9hZHNSZXN1bHRcbiAgaWYgKHhtbG9iai5Jc1RydW5jYXRlZCkge1xuICAgIHJlc3VsdC5pc1RydW5jYXRlZCA9IHhtbG9iai5Jc1RydW5jYXRlZFxuICB9XG4gIGlmICh4bWxvYmouTmV4dEtleU1hcmtlcikge1xuICAgIHJlc3VsdC5uZXh0S2V5TWFya2VyID0geG1sb2JqLk5leHRLZXlNYXJrZXJcbiAgfVxuICBpZiAoeG1sb2JqLk5leHRVcGxvYWRJZE1hcmtlcikge1xuICAgIHJlc3VsdC5uZXh0VXBsb2FkSWRNYXJrZXIgPSB4bWxvYmoubmV4dFVwbG9hZElkTWFya2VyIHx8ICcnXG4gIH1cblxuICBpZiAoeG1sb2JqLkNvbW1vblByZWZpeGVzKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ29tbW9uUHJlZml4ZXMpLmZvckVhY2goKHByZWZpeCkgPT4ge1xuICAgICAgcmVzdWx0LnByZWZpeGVzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkocHJlZml4LlByZWZpeClbMF0pIH0pXG4gICAgfSlcbiAgfVxuXG4gIGlmICh4bWxvYmouVXBsb2FkKSB7XG4gICAgdG9BcnJheSh4bWxvYmouVXBsb2FkKS5mb3JFYWNoKCh1cGxvYWQpID0+IHtcbiAgICAgIHZhciBrZXkgPSB1cGxvYWQuS2V5XG4gICAgICB2YXIgdXBsb2FkSWQgPSB1cGxvYWQuVXBsb2FkSWRcbiAgICAgIHZhciBpbml0aWF0b3IgPSB7IGlkOiB1cGxvYWQuSW5pdGlhdG9yLklELCBkaXNwbGF5TmFtZTogdXBsb2FkLkluaXRpYXRvci5EaXNwbGF5TmFtZSB9XG4gICAgICB2YXIgb3duZXIgPSB7IGlkOiB1cGxvYWQuT3duZXIuSUQsIGRpc3BsYXlOYW1lOiB1cGxvYWQuT3duZXIuRGlzcGxheU5hbWUgfVxuICAgICAgdmFyIHN0b3JhZ2VDbGFzcyA9IHVwbG9hZC5TdG9yYWdlQ2xhc3NcbiAgICAgIHZhciBpbml0aWF0ZWQgPSBuZXcgRGF0ZSh1cGxvYWQuSW5pdGlhdGVkKVxuICAgICAgcmVzdWx0LnVwbG9hZHMucHVzaCh7IGtleSwgdXBsb2FkSWQsIGluaXRpYXRvciwgb3duZXIsIHN0b3JhZ2VDbGFzcywgaW5pdGlhdGVkIH0pXG4gICAgfSlcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSB0byBsaXN0IGFsbCB0aGUgb3duZWQgYnVja2V0c1xuXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2UgZm9yIGJ1Y2tldCBub3RpZmljYXRpb25cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUJ1Y2tldE5vdGlmaWNhdGlvbih4bWwpIHtcbiAgdmFyIHJlc3VsdCA9IHtcbiAgICBUb3BpY0NvbmZpZ3VyYXRpb246IFtdLFxuICAgIFF1ZXVlQ29uZmlndXJhdGlvbjogW10sXG4gICAgQ2xvdWRGdW5jdGlvbkNvbmZpZ3VyYXRpb246IFtdLFxuICB9XG4gIC8vIFBhcnNlIHRoZSBldmVudHMgbGlzdFxuICB2YXIgZ2VuRXZlbnRzID0gZnVuY3Rpb24gKGV2ZW50cykge1xuICAgIHZhciByZXN1bHQgPSBbXVxuICAgIGlmIChldmVudHMpIHtcbiAgICAgIHRvQXJyYXkoZXZlbnRzKS5mb3JFYWNoKChzM2V2ZW50KSA9PiB7XG4gICAgICAgIHJlc3VsdC5wdXNoKHMzZXZlbnQpXG4gICAgICB9KVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cbiAgLy8gUGFyc2UgYWxsIGZpbHRlciBydWxlc1xuICB2YXIgZ2VuRmlsdGVyUnVsZXMgPSBmdW5jdGlvbiAoZmlsdGVycykge1xuICAgIHZhciByZXN1bHQgPSBbXVxuICAgIGlmIChmaWx0ZXJzKSB7XG4gICAgICBmaWx0ZXJzID0gdG9BcnJheShmaWx0ZXJzKVxuICAgICAgaWYgKGZpbHRlcnNbMF0uUzNLZXkpIHtcbiAgICAgICAgZmlsdGVyc1swXS5TM0tleSA9IHRvQXJyYXkoZmlsdGVyc1swXS5TM0tleSlcbiAgICAgICAgaWYgKGZpbHRlcnNbMF0uUzNLZXlbMF0uRmlsdGVyUnVsZSkge1xuICAgICAgICAgIHRvQXJyYXkoZmlsdGVyc1swXS5TM0tleVswXS5GaWx0ZXJSdWxlKS5mb3JFYWNoKChydWxlKSA9PiB7XG4gICAgICAgICAgICB2YXIgTmFtZSA9IHRvQXJyYXkocnVsZS5OYW1lKVswXVxuICAgICAgICAgICAgdmFyIFZhbHVlID0gdG9BcnJheShydWxlLlZhbHVlKVswXVxuICAgICAgICAgICAgcmVzdWx0LnB1c2goeyBOYW1lLCBWYWx1ZSB9KVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgdmFyIHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcbiAgeG1sb2JqID0geG1sb2JqLk5vdGlmaWNhdGlvbkNvbmZpZ3VyYXRpb25cblxuICAvLyBQYXJzZSBhbGwgdG9waWMgY29uZmlndXJhdGlvbnMgaW4gdGhlIHhtbFxuICBpZiAoeG1sb2JqLlRvcGljQ29uZmlndXJhdGlvbikge1xuICAgIHRvQXJyYXkoeG1sb2JqLlRvcGljQ29uZmlndXJhdGlvbikuZm9yRWFjaCgoY29uZmlnKSA9PiB7XG4gICAgICB2YXIgSWQgPSB0b0FycmF5KGNvbmZpZy5JZClbMF1cbiAgICAgIHZhciBUb3BpYyA9IHRvQXJyYXkoY29uZmlnLlRvcGljKVswXVxuICAgICAgdmFyIEV2ZW50ID0gZ2VuRXZlbnRzKGNvbmZpZy5FdmVudClcbiAgICAgIHZhciBGaWx0ZXIgPSBnZW5GaWx0ZXJSdWxlcyhjb25maWcuRmlsdGVyKVxuICAgICAgcmVzdWx0LlRvcGljQ29uZmlndXJhdGlvbi5wdXNoKHsgSWQsIFRvcGljLCBFdmVudCwgRmlsdGVyIH0pXG4gICAgfSlcbiAgfVxuICAvLyBQYXJzZSBhbGwgdG9waWMgY29uZmlndXJhdGlvbnMgaW4gdGhlIHhtbFxuICBpZiAoeG1sb2JqLlF1ZXVlQ29uZmlndXJhdGlvbikge1xuICAgIHRvQXJyYXkoeG1sb2JqLlF1ZXVlQ29uZmlndXJhdGlvbikuZm9yRWFjaCgoY29uZmlnKSA9PiB7XG4gICAgICB2YXIgSWQgPSB0b0FycmF5KGNvbmZpZy5JZClbMF1cbiAgICAgIHZhciBRdWV1ZSA9IHRvQXJyYXkoY29uZmlnLlF1ZXVlKVswXVxuICAgICAgdmFyIEV2ZW50ID0gZ2VuRXZlbnRzKGNvbmZpZy5FdmVudClcbiAgICAgIHZhciBGaWx0ZXIgPSBnZW5GaWx0ZXJSdWxlcyhjb25maWcuRmlsdGVyKVxuICAgICAgcmVzdWx0LlF1ZXVlQ29uZmlndXJhdGlvbi5wdXNoKHsgSWQsIFF1ZXVlLCBFdmVudCwgRmlsdGVyIH0pXG4gICAgfSlcbiAgfVxuICAvLyBQYXJzZSBhbGwgUXVldWVDb25maWd1cmF0aW9uIGFycmF5c1xuICBpZiAoeG1sb2JqLkNsb3VkRnVuY3Rpb25Db25maWd1cmF0aW9uKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ2xvdWRGdW5jdGlvbkNvbmZpZ3VyYXRpb24pLmZvckVhY2goKGNvbmZpZykgPT4ge1xuICAgICAgdmFyIElkID0gdG9BcnJheShjb25maWcuSWQpWzBdXG4gICAgICB2YXIgQ2xvdWRGdW5jdGlvbiA9IHRvQXJyYXkoY29uZmlnLkNsb3VkRnVuY3Rpb24pWzBdXG4gICAgICB2YXIgRXZlbnQgPSBnZW5FdmVudHMoY29uZmlnLkV2ZW50KVxuICAgICAgdmFyIEZpbHRlciA9IGdlbkZpbHRlclJ1bGVzKGNvbmZpZy5GaWx0ZXIpXG4gICAgICByZXN1bHQuQ2xvdWRGdW5jdGlvbkNvbmZpZ3VyYXRpb24ucHVzaCh7IElkLCBDbG91ZEZ1bmN0aW9uLCBFdmVudCwgRmlsdGVyIH0pXG4gICAgfSlcbiAgfVxuXG4gIHJldHVybiByZXN1bHRcbn1cblxuLy8gcGFyc2UgWE1MIHJlc3BvbnNlIHdoZW4gYSBtdWx0aXBhcnQgdXBsb2FkIGlzIGNvbXBsZXRlZFxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29tcGxldGVNdWx0aXBhcnQoeG1sKSB7XG4gIHZhciB4bWxvYmogPSBwYXJzZVhtbCh4bWwpLkNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0XG4gIGlmICh4bWxvYmouTG9jYXRpb24pIHtcbiAgICB2YXIgbG9jYXRpb24gPSB0b0FycmF5KHhtbG9iai5Mb2NhdGlvbilbMF1cbiAgICB2YXIgYnVja2V0ID0gdG9BcnJheSh4bWxvYmouQnVja2V0KVswXVxuICAgIHZhciBrZXkgPSB4bWxvYmouS2V5XG4gICAgdmFyIGV0YWcgPSB4bWxvYmouRVRhZy5yZXBsYWNlKC9eXCIvZywgJycpXG4gICAgICAucmVwbGFjZSgvXCIkL2csICcnKVxuICAgICAgLnJlcGxhY2UoL14mcXVvdDsvZywgJycpXG4gICAgICAucmVwbGFjZSgvJnF1b3Q7JC9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC9eJiMzNDsvZywgJycpXG4gICAgICAucmVwbGFjZSgvJiMzNDskL2csICcnKVxuXG4gICAgcmV0dXJuIHsgbG9jYXRpb24sIGJ1Y2tldCwga2V5LCBldGFnIH1cbiAgfVxuICAvLyBDb21wbGV0ZSBNdWx0aXBhcnQgY2FuIHJldHVybiBYTUwgRXJyb3IgYWZ0ZXIgYSAyMDAgT0sgcmVzcG9uc2VcbiAgaWYgKHhtbG9iai5Db2RlICYmIHhtbG9iai5NZXNzYWdlKSB7XG4gICAgdmFyIGVyckNvZGUgPSB0b0FycmF5KHhtbG9iai5Db2RlKVswXVxuICAgIHZhciBlcnJNZXNzYWdlID0gdG9BcnJheSh4bWxvYmouTWVzc2FnZSlbMF1cbiAgICByZXR1cm4geyBlcnJDb2RlLCBlcnJNZXNzYWdlIH1cbiAgfVxufVxuXG5jb25zdCBmb3JtYXRPYmpJbmZvID0gKGNvbnRlbnQsIG9wdHMgPSB7fSkgPT4ge1xuICBsZXQgeyBLZXksIExhc3RNb2RpZmllZCwgRVRhZywgU2l6ZSwgVmVyc2lvbklkLCBJc0xhdGVzdCB9ID0gY29udGVudFxuXG4gIGlmICghaXNPYmplY3Qob3B0cykpIHtcbiAgICBvcHRzID0ge31cbiAgfVxuXG4gIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KEtleSlbMF0pXG4gIGNvbnN0IGxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKHRvQXJyYXkoTGFzdE1vZGlmaWVkKVswXSlcbiAgY29uc3QgZXRhZyA9IHNhbml0aXplRVRhZyh0b0FycmF5KEVUYWcpWzBdKVxuICBjb25zdCBzaXplID0gc2FuaXRpemVTaXplKFNpemUpXG5cbiAgcmV0dXJuIHtcbiAgICBuYW1lLFxuICAgIGxhc3RNb2RpZmllZCxcbiAgICBldGFnLFxuICAgIHNpemUsXG4gICAgdmVyc2lvbklkOiBWZXJzaW9uSWQsXG4gICAgaXNMYXRlc3Q6IElzTGF0ZXN0LFxuICAgIGlzRGVsZXRlTWFya2VyOiBvcHRzLklzRGVsZXRlTWFya2VyID8gb3B0cy5Jc0RlbGV0ZU1hcmtlciA6IGZhbHNlLFxuICB9XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdCBvYmplY3RzIGluIGEgYnVja2V0XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0T2JqZWN0cyh4bWwpIHtcbiAgdmFyIHJlc3VsdCA9IHtcbiAgICBvYmplY3RzOiBbXSxcbiAgICBpc1RydW5jYXRlZDogZmFsc2UsXG4gIH1cbiAgbGV0IGlzVHJ1bmNhdGVkID0gZmFsc2VcbiAgbGV0IG5leHRNYXJrZXIsIG5leHRWZXJzaW9uS2V5TWFya2VyXG4gIGNvbnN0IHhtbG9iaiA9IGZ4cFdpdGhvdXROdW1QYXJzZXIucGFyc2UoeG1sKVxuXG4gIGNvbnN0IHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkgPSAocmVzcG9uc2VFbnRpdHkpID0+IHtcbiAgICBpZiAocmVzcG9uc2VFbnRpdHkpIHtcbiAgICAgIHRvQXJyYXkocmVzcG9uc2VFbnRpdHkpLmZvckVhY2goKGNvbW1vblByZWZpeCkgPT4ge1xuICAgICAgICByZXN1bHQub2JqZWN0cy5wdXNoKHsgcHJlZml4OiBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KGNvbW1vblByZWZpeC5QcmVmaXgpWzBdKSwgc2l6ZTogMCB9KVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICBjb25zdCBsaXN0QnVja2V0UmVzdWx0ID0geG1sb2JqLkxpc3RCdWNrZXRSZXN1bHRcbiAgY29uc3QgbGlzdFZlcnNpb25zUmVzdWx0ID0geG1sb2JqLkxpc3RWZXJzaW9uc1Jlc3VsdFxuXG4gIGlmIChsaXN0QnVja2V0UmVzdWx0KSB7XG4gICAgaWYgKGxpc3RCdWNrZXRSZXN1bHQuSXNUcnVuY2F0ZWQpIHtcbiAgICAgIGlzVHJ1bmNhdGVkID0gbGlzdEJ1Y2tldFJlc3VsdC5Jc1RydW5jYXRlZFxuICAgIH1cbiAgICBpZiAobGlzdEJ1Y2tldFJlc3VsdC5Db250ZW50cykge1xuICAgICAgdG9BcnJheShsaXN0QnVja2V0UmVzdWx0LkNvbnRlbnRzKS5mb3JFYWNoKChjb250ZW50KSA9PiB7XG4gICAgICAgIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KGNvbnRlbnQuS2V5KVswXSlcbiAgICAgICAgY29uc3QgbGFzdE1vZGlmaWVkID0gbmV3IERhdGUodG9BcnJheShjb250ZW50Lkxhc3RNb2RpZmllZClbMF0pXG4gICAgICAgIGNvbnN0IGV0YWcgPSBzYW5pdGl6ZUVUYWcodG9BcnJheShjb250ZW50LkVUYWcpWzBdKVxuICAgICAgICBjb25zdCBzaXplID0gc2FuaXRpemVTaXplKGNvbnRlbnQuU2l6ZSlcbiAgICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IG5hbWUsIGxhc3RNb2RpZmllZCwgZXRhZywgc2l6ZSB9KVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAobGlzdEJ1Y2tldFJlc3VsdC5OZXh0TWFya2VyKSB7XG4gICAgICBuZXh0TWFya2VyID0gbGlzdEJ1Y2tldFJlc3VsdC5OZXh0TWFya2VyXG4gICAgfVxuICAgIHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkobGlzdEJ1Y2tldFJlc3VsdC5Db21tb25QcmVmaXhlcylcbiAgfVxuXG4gIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQpIHtcbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0LklzVHJ1bmNhdGVkKSB7XG4gICAgICBpc1RydW5jYXRlZCA9IGxpc3RWZXJzaW9uc1Jlc3VsdC5Jc1RydW5jYXRlZFxuICAgIH1cblxuICAgIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQuVmVyc2lvbikge1xuICAgICAgdG9BcnJheShsaXN0VmVyc2lvbnNSZXN1bHQuVmVyc2lvbikuZm9yRWFjaCgoY29udGVudCkgPT4ge1xuICAgICAgICByZXN1bHQub2JqZWN0cy5wdXNoKGZvcm1hdE9iakluZm8oY29udGVudCkpXG4gICAgICB9KVxuICAgIH1cbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0LkRlbGV0ZU1hcmtlcikge1xuICAgICAgdG9BcnJheShsaXN0VmVyc2lvbnNSZXN1bHQuRGVsZXRlTWFya2VyKS5mb3JFYWNoKChjb250ZW50KSA9PiB7XG4gICAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goZm9ybWF0T2JqSW5mbyhjb250ZW50LCB7IElzRGVsZXRlTWFya2VyOiB0cnVlIH0pKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0Lk5leHRLZXlNYXJrZXIpIHtcbiAgICAgIG5leHRWZXJzaW9uS2V5TWFya2VyID0gbGlzdFZlcnNpb25zUmVzdWx0Lk5leHRLZXlNYXJrZXJcbiAgICB9XG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5OZXh0VmVyc2lvbklkTWFya2VyKSB7XG4gICAgICByZXN1bHQudmVyc2lvbklkTWFya2VyID0gbGlzdFZlcnNpb25zUmVzdWx0Lk5leHRWZXJzaW9uSWRNYXJrZXJcbiAgICB9XG4gICAgcGFyc2VDb21tb25QcmVmaXhlc0VudGl0eShsaXN0VmVyc2lvbnNSZXN1bHQuQ29tbW9uUHJlZml4ZXMpXG4gIH1cblxuICByZXN1bHQuaXNUcnVuY2F0ZWQgPSBpc1RydW5jYXRlZFxuICBpZiAoaXNUcnVuY2F0ZWQpIHtcbiAgICByZXN1bHQubmV4dE1hcmtlciA9IG5leHRWZXJzaW9uS2V5TWFya2VyIHx8IG5leHRNYXJrZXJcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdCBvYmplY3RzIHYyIGluIGEgYnVja2V0XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0T2JqZWN0c1YyKHhtbCkge1xuICB2YXIgcmVzdWx0ID0ge1xuICAgIG9iamVjdHM6IFtdLFxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcbiAgfVxuICB2YXIgeG1sb2JqID0gcGFyc2VYbWwoeG1sKVxuICBpZiAoIXhtbG9iai5MaXN0QnVja2V0UmVzdWx0KSB7XG4gICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIkxpc3RCdWNrZXRSZXN1bHRcIicpXG4gIH1cbiAgeG1sb2JqID0geG1sb2JqLkxpc3RCdWNrZXRSZXN1bHRcbiAgaWYgKHhtbG9iai5Jc1RydW5jYXRlZCkge1xuICAgIHJlc3VsdC5pc1RydW5jYXRlZCA9IHhtbG9iai5Jc1RydW5jYXRlZFxuICB9XG4gIGlmICh4bWxvYmouTmV4dENvbnRpbnVhdGlvblRva2VuKSB7XG4gICAgcmVzdWx0Lm5leHRDb250aW51YXRpb25Ub2tlbiA9IHhtbG9iai5OZXh0Q29udGludWF0aW9uVG9rZW5cbiAgfVxuICBpZiAoeG1sb2JqLkNvbnRlbnRzKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ29udGVudHMpLmZvckVhY2goKGNvbnRlbnQpID0+IHtcbiAgICAgIHZhciBuYW1lID0gc2FuaXRpemVPYmplY3RLZXkodG9BcnJheShjb250ZW50LktleSlbMF0pXG4gICAgICB2YXIgbGFzdE1vZGlmaWVkID0gbmV3IERhdGUoY29udGVudC5MYXN0TW9kaWZpZWQpXG4gICAgICB2YXIgZXRhZyA9IHNhbml0aXplRVRhZyhjb250ZW50LkVUYWcpXG4gICAgICB2YXIgc2l6ZSA9IGNvbnRlbnQuU2l6ZVxuICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IG5hbWUsIGxhc3RNb2RpZmllZCwgZXRhZywgc2l6ZSB9KVxuICAgIH0pXG4gIH1cbiAgaWYgKHhtbG9iai5Db21tb25QcmVmaXhlcykge1xuICAgIHRvQXJyYXkoeG1sb2JqLkNvbW1vblByZWZpeGVzKS5mb3JFYWNoKChjb21tb25QcmVmaXgpID0+IHtcbiAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkoY29tbW9uUHJlZml4LlByZWZpeClbMF0pLCBzaXplOiAwIH0pXG4gICAgfSlcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdCBvYmplY3RzIHYyIHdpdGggbWV0YWRhdGEgaW4gYSBidWNrZXRcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUxpc3RPYmplY3RzVjJXaXRoTWV0YWRhdGEoeG1sKSB7XG4gIHZhciByZXN1bHQgPSB7XG4gICAgb2JqZWN0czogW10sXG4gICAgaXNUcnVuY2F0ZWQ6IGZhbHNlLFxuICB9XG4gIHZhciB4bWxvYmogPSBwYXJzZVhtbCh4bWwpXG4gIGlmICgheG1sb2JqLkxpc3RCdWNrZXRSZXN1bHQpIHtcbiAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRYTUxFcnJvcignTWlzc2luZyB0YWc6IFwiTGlzdEJ1Y2tldFJlc3VsdFwiJylcbiAgfVxuICB4bWxvYmogPSB4bWxvYmouTGlzdEJ1Y2tldFJlc3VsdFxuICBpZiAoeG1sb2JqLklzVHJ1bmNhdGVkKSB7XG4gICAgcmVzdWx0LmlzVHJ1bmNhdGVkID0geG1sb2JqLklzVHJ1bmNhdGVkXG4gIH1cbiAgaWYgKHhtbG9iai5OZXh0Q29udGludWF0aW9uVG9rZW4pIHtcbiAgICByZXN1bHQubmV4dENvbnRpbnVhdGlvblRva2VuID0geG1sb2JqLk5leHRDb250aW51YXRpb25Ub2tlblxuICB9XG5cbiAgaWYgKHhtbG9iai5Db250ZW50cykge1xuICAgIHRvQXJyYXkoeG1sb2JqLkNvbnRlbnRzKS5mb3JFYWNoKChjb250ZW50KSA9PiB7XG4gICAgICB2YXIgbmFtZSA9IHNhbml0aXplT2JqZWN0S2V5KGNvbnRlbnQuS2V5KVxuICAgICAgdmFyIGxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKGNvbnRlbnQuTGFzdE1vZGlmaWVkKVxuICAgICAgdmFyIGV0YWcgPSBzYW5pdGl6ZUVUYWcoY29udGVudC5FVGFnKVxuICAgICAgdmFyIHNpemUgPSBjb250ZW50LlNpemVcbiAgICAgIHZhciBtZXRhZGF0YVxuICAgICAgaWYgKGNvbnRlbnQuVXNlck1ldGFkYXRhICE9IG51bGwpIHtcbiAgICAgICAgbWV0YWRhdGEgPSB0b0FycmF5KGNvbnRlbnQuVXNlck1ldGFkYXRhKVswXVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWV0YWRhdGEgPSBudWxsXG4gICAgICB9XG4gICAgICByZXN1bHQub2JqZWN0cy5wdXNoKHsgbmFtZSwgbGFzdE1vZGlmaWVkLCBldGFnLCBzaXplLCBtZXRhZGF0YSB9KVxuICAgIH0pXG4gIH1cblxuICBpZiAoeG1sb2JqLkNvbW1vblByZWZpeGVzKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ29tbW9uUHJlZml4ZXMpLmZvckVhY2goKGNvbW1vblByZWZpeCkgPT4ge1xuICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IHByZWZpeDogc2FuaXRpemVPYmplY3RLZXkodG9BcnJheShjb21tb25QcmVmaXguUHJlZml4KVswXSksIHNpemU6IDAgfSlcbiAgICB9KVxuICB9XG4gIHJldHVybiByZXN1bHRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQnVja2V0VmVyc2lvbmluZ0NvbmZpZyh4bWwpIHtcbiAgdmFyIHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcbiAgcmV0dXJuIHhtbE9iai5WZXJzaW9uaW5nQ29uZmlndXJhdGlvblxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VUYWdnaW5nKHhtbCkge1xuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXG4gIGxldCByZXN1bHQgPSBbXVxuICBpZiAoeG1sT2JqLlRhZ2dpbmcgJiYgeG1sT2JqLlRhZ2dpbmcuVGFnU2V0ICYmIHhtbE9iai5UYWdnaW5nLlRhZ1NldC5UYWcpIHtcbiAgICBjb25zdCB0YWdSZXN1bHQgPSB4bWxPYmouVGFnZ2luZy5UYWdTZXQuVGFnXG4gICAgLy8gaWYgaXQgaXMgYSBzaW5nbGUgdGFnIGNvbnZlcnQgaW50byBhbiBhcnJheSBzbyB0aGF0IHRoZSByZXR1cm4gdmFsdWUgaXMgYWx3YXlzIGFuIGFycmF5LlxuICAgIGlmIChpc09iamVjdCh0YWdSZXN1bHQpKSB7XG4gICAgICByZXN1bHQucHVzaCh0YWdSZXN1bHQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdCA9IHRhZ1Jlc3VsdFxuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUxpZmVjeWNsZUNvbmZpZyh4bWwpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICByZXR1cm4geG1sT2JqLkxpZmVjeWNsZUNvbmZpZ3VyYXRpb25cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlT2JqZWN0TG9ja0NvbmZpZyh4bWwpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBsZXQgbG9ja0NvbmZpZ1Jlc3VsdCA9IHt9XG4gIGlmICh4bWxPYmouT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24pIHtcbiAgICBsb2NrQ29uZmlnUmVzdWx0ID0ge1xuICAgICAgb2JqZWN0TG9ja0VuYWJsZWQ6IHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbi5PYmplY3RMb2NrRW5hYmxlZCxcbiAgICB9XG4gICAgbGV0IHJldGVudGlvblJlc3BcbiAgICBpZiAoXG4gICAgICB4bWxPYmouT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24gJiZcbiAgICAgIHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbi5SdWxlICYmXG4gICAgICB4bWxPYmouT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24uUnVsZS5EZWZhdWx0UmV0ZW50aW9uXG4gICAgKSB7XG4gICAgICByZXRlbnRpb25SZXNwID0geG1sT2JqLk9iamVjdExvY2tDb25maWd1cmF0aW9uLlJ1bGUuRGVmYXVsdFJldGVudGlvbiB8fCB7fVxuICAgICAgbG9ja0NvbmZpZ1Jlc3VsdC5tb2RlID0gcmV0ZW50aW9uUmVzcC5Nb2RlXG4gICAgfVxuICAgIGlmIChyZXRlbnRpb25SZXNwKSB7XG4gICAgICBjb25zdCBpc1VuaXRZZWFycyA9IHJldGVudGlvblJlc3AuWWVhcnNcbiAgICAgIGlmIChpc1VuaXRZZWFycykge1xuICAgICAgICBsb2NrQ29uZmlnUmVzdWx0LnZhbGlkaXR5ID0gaXNVbml0WWVhcnNcbiAgICAgICAgbG9ja0NvbmZpZ1Jlc3VsdC51bml0ID0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLllFQVJTXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2NrQ29uZmlnUmVzdWx0LnZhbGlkaXR5ID0gcmV0ZW50aW9uUmVzcC5EYXlzXG4gICAgICAgIGxvY2tDb25maWdSZXN1bHQudW5pdCA9IFJFVEVOVElPTl9WQUxJRElUWV9VTklUUy5EQVlTXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBsb2NrQ29uZmlnUmVzdWx0XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlT2JqZWN0UmV0ZW50aW9uQ29uZmlnKHhtbCkge1xuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXG4gIGNvbnN0IHJldGVudGlvbkNvbmZpZyA9IHhtbE9iai5SZXRlbnRpb25cblxuICByZXR1cm4ge1xuICAgIG1vZGU6IHJldGVudGlvbkNvbmZpZy5Nb2RlLFxuICAgIHJldGFpblVudGlsRGF0ZTogcmV0ZW50aW9uQ29uZmlnLlJldGFpblVudGlsRGF0ZSxcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VCdWNrZXRFbmNyeXB0aW9uQ29uZmlnKHhtbCkge1xuICBsZXQgZW5jQ29uZmlnID0gcGFyc2VYbWwoeG1sKVxuICByZXR1cm4gZW5jQ29uZmlnXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyh4bWwpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICByZXR1cm4geG1sT2JqLkxlZ2FsSG9sZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdXBsb2FkUGFydFBhcnNlcih4bWwpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBjb25zdCByZXNwRWwgPSB4bWxPYmouQ29weVBhcnRSZXN1bHRcbiAgcmV0dXJuIHJlc3BFbFxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlT2JqZWN0c1BhcnNlcih4bWwpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBpZiAoeG1sT2JqLkRlbGV0ZVJlc3VsdCAmJiB4bWxPYmouRGVsZXRlUmVzdWx0LkVycm9yKSB7XG4gICAgLy8gcmV0dXJuIGVycm9ycyBhcyBhcnJheSBhbHdheXMuIGFzIHRoZSByZXNwb25zZSBpcyBvYmplY3QgaW4gY2FzZSBvZiBzaW5nbGUgb2JqZWN0IHBhc3NlZCBpbiByZW1vdmVPYmplY3RzXG4gICAgcmV0dXJuIHRvQXJyYXkoeG1sT2JqLkRlbGV0ZVJlc3VsdC5FcnJvcilcbiAgfVxuICByZXR1cm4gW11cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlKHJlcykge1xuICAvLyBleHRyYWN0SGVhZGVyVHlwZSBleHRyYWN0cyB0aGUgZmlyc3QgaGFsZiBvZiB0aGUgaGVhZGVyIG1lc3NhZ2UsIHRoZSBoZWFkZXIgdHlwZS5cbiAgZnVuY3Rpb24gZXh0cmFjdEhlYWRlclR5cGUoc3RyZWFtKSB7XG4gICAgY29uc3QgaGVhZGVyTmFtZUxlbiA9IEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKDEpKS5yZWFkVUludDgoKVxuICAgIGNvbnN0IGhlYWRlck5hbWVXaXRoU2VwYXJhdG9yID0gQnVmZmVyLmZyb20oc3RyZWFtLnJlYWQoaGVhZGVyTmFtZUxlbikpLnRvU3RyaW5nKClcbiAgICBjb25zdCBzcGxpdEJ5U2VwYXJhdG9yID0gKGhlYWRlck5hbWVXaXRoU2VwYXJhdG9yIHx8ICcnKS5zcGxpdCgnOicpXG4gICAgY29uc3QgaGVhZGVyTmFtZSA9IHNwbGl0QnlTZXBhcmF0b3IubGVuZ3RoID49IDEgPyBzcGxpdEJ5U2VwYXJhdG9yWzFdIDogJydcbiAgICByZXR1cm4gaGVhZGVyTmFtZVxuICB9XG5cbiAgZnVuY3Rpb24gZXh0cmFjdEhlYWRlclZhbHVlKHN0cmVhbSkge1xuICAgIGNvbnN0IGJvZHlMZW4gPSBCdWZmZXIuZnJvbShzdHJlYW0ucmVhZCgyKSkucmVhZFVJbnQxNkJFKClcbiAgICBjb25zdCBib2R5TmFtZSA9IEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKGJvZHlMZW4pKS50b1N0cmluZygpXG4gICAgcmV0dXJuIGJvZHlOYW1lXG4gIH1cblxuICBjb25zdCBzZWxlY3RSZXN1bHRzID0gbmV3IFNlbGVjdFJlc3VsdHMoe30pIC8vIHdpbGwgYmUgcmV0dXJuZWRcblxuICBjb25zdCByZXNwb25zZVN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKHJlcykgLy8gY29udmVydCBieXRlIGFycmF5IHRvIGEgcmVhZGFibGUgcmVzcG9uc2VTdHJlYW1cbiAgd2hpbGUgKHJlc3BvbnNlU3RyZWFtLl9yZWFkYWJsZVN0YXRlLmxlbmd0aCkge1xuICAgIC8vIFRvcCBsZXZlbCByZXNwb25zZVN0cmVhbSByZWFkIHRyYWNrZXIuXG4gICAgbGV0IG1zZ0NyY0FjY3VtdWxhdG9yIC8vIGFjY3VtdWxhdGUgZnJvbSBzdGFydCBvZiB0aGUgbWVzc2FnZSB0aWxsIHRoZSBtZXNzYWdlIGNyYyBzdGFydC5cblxuICAgIGNvbnN0IHRvdGFsQnl0ZUxlbmd0aEJ1ZmZlciA9IEJ1ZmZlci5mcm9tKHJlc3BvbnNlU3RyZWFtLnJlYWQoNCkpXG4gICAgbXNnQ3JjQWNjdW11bGF0b3IgPSBjcmMzMih0b3RhbEJ5dGVMZW5ndGhCdWZmZXIpXG5cbiAgICBjb25zdCBoZWFkZXJCeXRlc0J1ZmZlciA9IEJ1ZmZlci5mcm9tKHJlc3BvbnNlU3RyZWFtLnJlYWQoNCkpXG4gICAgbXNnQ3JjQWNjdW11bGF0b3IgPSBjcmMzMihoZWFkZXJCeXRlc0J1ZmZlciwgbXNnQ3JjQWNjdW11bGF0b3IpXG5cbiAgICBjb25zdCBjYWxjdWxhdGVkUHJlbHVkZUNyYyA9IG1zZ0NyY0FjY3VtdWxhdG9yLnJlYWRJbnQzMkJFKCkgLy8gdXNlIGl0IHRvIGNoZWNrIGlmIGFueSBDUkMgbWlzbWF0Y2ggaW4gaGVhZGVyIGl0c2VsZi5cblxuICAgIGNvbnN0IHByZWx1ZGVDcmNCdWZmZXIgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKDQpKSAvLyByZWFkIDQgYnl0ZXMgICAgaS5lIDQrNCA9OCArIDQgPSAxMiAoIHByZWx1ZGUgKyBwcmVsdWRlIGNyYylcbiAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKHByZWx1ZGVDcmNCdWZmZXIsIG1zZ0NyY0FjY3VtdWxhdG9yKVxuXG4gICAgY29uc3QgdG90YWxNc2dMZW5ndGggPSB0b3RhbEJ5dGVMZW5ndGhCdWZmZXIucmVhZEludDMyQkUoKVxuICAgIGNvbnN0IGhlYWRlckxlbmd0aCA9IGhlYWRlckJ5dGVzQnVmZmVyLnJlYWRJbnQzMkJFKClcbiAgICBjb25zdCBwcmVsdWRlQ3JjQnl0ZVZhbHVlID0gcHJlbHVkZUNyY0J1ZmZlci5yZWFkSW50MzJCRSgpXG5cbiAgICBpZiAocHJlbHVkZUNyY0J5dGVWYWx1ZSAhPT0gY2FsY3VsYXRlZFByZWx1ZGVDcmMpIHtcbiAgICAgIC8vIEhhbmRsZSBIZWFkZXIgQ1JDIG1pc21hdGNoIEVycm9yXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBIZWFkZXIgQ2hlY2tzdW0gTWlzbWF0Y2gsIFByZWx1ZGUgQ1JDIG9mICR7cHJlbHVkZUNyY0J5dGVWYWx1ZX0gZG9lcyBub3QgZXF1YWwgZXhwZWN0ZWQgQ1JDIG9mICR7Y2FsY3VsYXRlZFByZWx1ZGVDcmN9YCxcbiAgICAgIClcbiAgICB9XG5cbiAgICBjb25zdCBoZWFkZXJzID0ge31cbiAgICBpZiAoaGVhZGVyTGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgaGVhZGVyQnl0ZXMgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKGhlYWRlckxlbmd0aCkpXG4gICAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKGhlYWRlckJ5dGVzLCBtc2dDcmNBY2N1bXVsYXRvcilcbiAgICAgIGNvbnN0IGhlYWRlclJlYWRlclN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKGhlYWRlckJ5dGVzKVxuICAgICAgd2hpbGUgKGhlYWRlclJlYWRlclN0cmVhbS5fcmVhZGFibGVTdGF0ZS5sZW5ndGgpIHtcbiAgICAgICAgbGV0IGhlYWRlclR5cGVOYW1lID0gZXh0cmFjdEhlYWRlclR5cGUoaGVhZGVyUmVhZGVyU3RyZWFtKVxuICAgICAgICBoZWFkZXJSZWFkZXJTdHJlYW0ucmVhZCgxKSAvLyBqdXN0IHJlYWQgYW5kIGlnbm9yZSBpdC5cbiAgICAgICAgaGVhZGVyc1toZWFkZXJUeXBlTmFtZV0gPSBleHRyYWN0SGVhZGVyVmFsdWUoaGVhZGVyUmVhZGVyU3RyZWFtKVxuICAgICAgfVxuICAgIH1cblxuICAgIGxldCBwYXlsb2FkU3RyZWFtXG4gICAgY29uc3QgcGF5TG9hZExlbmd0aCA9IHRvdGFsTXNnTGVuZ3RoIC0gaGVhZGVyTGVuZ3RoIC0gMTZcbiAgICBpZiAocGF5TG9hZExlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHBheUxvYWRCdWZmZXIgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKHBheUxvYWRMZW5ndGgpKVxuICAgICAgbXNnQ3JjQWNjdW11bGF0b3IgPSBjcmMzMihwYXlMb2FkQnVmZmVyLCBtc2dDcmNBY2N1bXVsYXRvcilcbiAgICAgIC8vIHJlYWQgdGhlIGNoZWNrc3VtIGVhcmx5IGFuZCBkZXRlY3QgYW55IG1pc21hdGNoIHNvIHdlIGNhbiBhdm9pZCB1bm5lY2Vzc2FyeSBmdXJ0aGVyIHByb2Nlc3NpbmcuXG4gICAgICBjb25zdCBtZXNzYWdlQ3JjQnl0ZVZhbHVlID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZCg0KSkucmVhZEludDMyQkUoKVxuICAgICAgY29uc3QgY2FsY3VsYXRlZENyYyA9IG1zZ0NyY0FjY3VtdWxhdG9yLnJlYWRJbnQzMkJFKClcbiAgICAgIC8vIEhhbmRsZSBtZXNzYWdlIENSQyBFcnJvclxuICAgICAgaWYgKG1lc3NhZ2VDcmNCeXRlVmFsdWUgIT09IGNhbGN1bGF0ZWRDcmMpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIGBNZXNzYWdlIENoZWNrc3VtIE1pc21hdGNoLCBNZXNzYWdlIENSQyBvZiAke21lc3NhZ2VDcmNCeXRlVmFsdWV9IGRvZXMgbm90IGVxdWFsIGV4cGVjdGVkIENSQyBvZiAke2NhbGN1bGF0ZWRDcmN9YCxcbiAgICAgICAgKVxuICAgICAgfVxuICAgICAgcGF5bG9hZFN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKHBheUxvYWRCdWZmZXIpXG4gICAgfVxuXG4gICAgY29uc3QgbWVzc2FnZVR5cGUgPSBoZWFkZXJzWydtZXNzYWdlLXR5cGUnXVxuXG4gICAgc3dpdGNoIChtZXNzYWdlVHlwZSkge1xuICAgICAgY2FzZSAnZXJyb3InOiB7XG4gICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGhlYWRlcnNbJ2Vycm9yLWNvZGUnXSArICc6XCInICsgaGVhZGVyc1snZXJyb3ItbWVzc2FnZSddICsgJ1wiJ1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKVxuICAgICAgfVxuICAgICAgY2FzZSAnZXZlbnQnOiB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gaGVhZGVyc1snY29udGVudC10eXBlJ11cbiAgICAgICAgY29uc3QgZXZlbnRUeXBlID0gaGVhZGVyc1snZXZlbnQtdHlwZSddXG5cbiAgICAgICAgc3dpdGNoIChldmVudFR5cGUpIHtcbiAgICAgICAgICBjYXNlICdFbmQnOiB7XG4gICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFJlc3BvbnNlKHJlcylcbiAgICAgICAgICAgIHJldHVybiBzZWxlY3RSZXN1bHRzXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY2FzZSAnUmVjb3Jkcyc6IHtcbiAgICAgICAgICAgIGNvbnN0IHJlYWREYXRhID0gcGF5bG9hZFN0cmVhbS5yZWFkKHBheUxvYWRMZW5ndGgpXG4gICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFJlY29yZHMocmVhZERhdGEpXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNhc2UgJ1Byb2dyZXNzJzpcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3dpdGNoIChjb250ZW50VHlwZSkge1xuICAgICAgICAgICAgICAgIGNhc2UgJ3RleHQveG1sJzoge1xuICAgICAgICAgICAgICAgICAgY29uc3QgcHJvZ3Jlc3NEYXRhID0gcGF5bG9hZFN0cmVhbS5yZWFkKHBheUxvYWRMZW5ndGgpXG4gICAgICAgICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFByb2dyZXNzKHByb2dyZXNzRGF0YS50b1N0cmluZygpKVxuICAgICAgICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZGVmYXVsdDoge1xuICAgICAgICAgICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gYFVuZXhwZWN0ZWQgY29udGVudC10eXBlICR7Y29udGVudFR5cGV9IHNlbnQgZm9yIGV2ZW50LXR5cGUgUHJvZ3Jlc3NgXG4gICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICBjYXNlICdTdGF0cyc6XG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHN3aXRjaCAoY29udGVudFR5cGUpIHtcbiAgICAgICAgICAgICAgICBjYXNlICd0ZXh0L3htbCc6IHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRzRGF0YSA9IHBheWxvYWRTdHJlYW0ucmVhZChwYXlMb2FkTGVuZ3RoKVxuICAgICAgICAgICAgICAgICAgc2VsZWN0UmVzdWx0cy5zZXRTdGF0cyhzdGF0c0RhdGEudG9TdHJpbmcoKSlcbiAgICAgICAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGBVbmV4cGVjdGVkIGNvbnRlbnQtdHlwZSAke2NvbnRlbnRUeXBlfSBzZW50IGZvciBldmVudC10eXBlIFN0YXRzYFxuICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yTWVzc2FnZSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgZGVmYXVsdDoge1xuICAgICAgICAgICAgLy8gQ29udGludWF0aW9uIG1lc3NhZ2U6IE5vdCBzdXJlIGlmIGl0IGlzIHN1cHBvcnRlZC4gZGlkIG5vdCBmaW5kIGEgcmVmZXJlbmNlIG9yIGFueSBtZXNzYWdlIGluIHJlc3BvbnNlLlxuICAgICAgICAgICAgLy8gSXQgZG9lcyBub3QgaGF2ZSBhIHBheWxvYWQuXG4gICAgICAgICAgICBjb25zdCB3YXJuaW5nTWVzc2FnZSA9IGBVbiBpbXBsZW1lbnRlZCBldmVudCBkZXRlY3RlZCAgJHttZXNzYWdlVHlwZX0uYFxuICAgICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybih3YXJuaW5nTWVzc2FnZSlcbiAgICAgICAgICB9XG4gICAgICAgIH0gLy8gZXZlbnRUeXBlIEVuZFxuICAgICAgfSAvLyBFdmVudCBFbmRcbiAgICB9IC8vIG1lc3NhZ2VUeXBlIEVuZFxuICB9IC8vIFRvcCBMZXZlbCBTdHJlYW0gRW5kXG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFnQkEsSUFBQUEsVUFBQSxHQUFBQyxPQUFBO0FBQ0EsSUFBQUMsY0FBQSxHQUFBRCxPQUFBO0FBRUEsSUFBQUUsTUFBQSxHQUFBQyx1QkFBQSxDQUFBSCxPQUFBO0FBQ0EsSUFBQUksUUFBQSxHQUFBSixPQUFBO0FBQ0EsSUFBQUssT0FBQSxHQUFBTCxPQUFBO0FBU0EsSUFBQU0sS0FBQSxHQUFBTixPQUFBO0FBQTZELFNBQUFPLHlCQUFBQyxXQUFBLGVBQUFDLE9BQUEsa0NBQUFDLGlCQUFBLE9BQUFELE9BQUEsUUFBQUUsZ0JBQUEsT0FBQUYsT0FBQSxZQUFBRix3QkFBQSxZQUFBQSxDQUFBQyxXQUFBLFdBQUFBLFdBQUEsR0FBQUcsZ0JBQUEsR0FBQUQsaUJBQUEsS0FBQUYsV0FBQTtBQUFBLFNBQUFMLHdCQUFBUyxHQUFBLEVBQUFKLFdBQUEsU0FBQUEsV0FBQSxJQUFBSSxHQUFBLElB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