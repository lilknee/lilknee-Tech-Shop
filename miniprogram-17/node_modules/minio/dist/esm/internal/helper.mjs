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

import * as crypto from "crypto";
import * as stream from "stream";
import { XMLParser } from 'fast-xml-parser';
import ipaddr from 'ipaddr.js';
import _ from 'lodash';
import * as mime from 'mime-types';
import { ENCRYPTION_TYPES } from "./type.mjs";
const MetaDataHeaderPrefix = 'x-amz-meta-';

/**
 * All characters in string which are NOT unreserved should be percent encoded.
 * Unreserved characters are : ALPHA / DIGIT / "-" / "." / "_" / "~"
 * Reference https://tools.ietf.org/html/rfc3986#section-2.2
 */
export function uriEscape(string) {
  return string.split('').reduce((acc, elem) => {
    const buf = Buffer.from(elem);
    if (buf.length === 1) {
      // length 1 indicates that elem is not a unicode character.
      // Check if it is an unreserved characer.
      if ('A' <= elem && elem <= 'Z' || 'a' <= elem && elem <= 'z' || '0' <= elem && elem <= '9' || elem === '_' || elem === '.' || elem === '~' || elem === '-') {
        // Unreserved characer should not be encoded.
        acc = acc + elem;
        return acc;
      }
    }
    // elem needs encoding - i.e elem should be encoded if it's not unreserved
    // character or if it's a unicode character.
    for (const char of buf) {
      acc = acc + '%' + char.toString(16).toUpperCase();
    }
    return acc;
  }, '');
}
export function uriResourceEscape(string) {
  return uriEscape(string).replace(/%2F/g, '/');
}
export function getScope(region, date, serviceName = 's3') {
  return `${makeDateShort(date)}/${region}/${serviceName}/aws4_request`;
}

/**
 * isAmazonEndpoint - true if endpoint is 's3.amazonaws.com' or 's3.cn-north-1.amazonaws.com.cn'
 */
export function isAmazonEndpoint(endpoint) {
  return endpoint === 's3.amazonaws.com' || endpoint === 's3.cn-north-1.amazonaws.com.cn';
}

/**
 * isVirtualHostStyle - verify if bucket name is support with virtual
 * hosts. bucketNames with periods should be always treated as path
 * style if the protocol is 'https:', this is due to SSL wildcard
 * limitation. For all other buckets and Amazon S3 endpoint we will
 * default to virtual host style.
 */
export function isVirtualHostStyle(endpoint, protocol, bucket, pathStyle) {
  if (protocol === 'https:' && bucket.includes('.')) {
    return false;
  }
  return isAmazonEndpoint(endpoint) || !pathStyle;
}
export function isValidIP(ip) {
  return ipaddr.isValid(ip);
}

/**
 * @returns if endpoint is valid domain.
 */
export function isValidEndpoint(endpoint) {
  return isValidDomain(endpoint) || isValidIP(endpoint);
}

/**
 * @returns if input host is a valid domain.
 */
export function isValidDomain(host) {
  if (!isString(host)) {
    return false;
  }
  // See RFC 1035, RFC 3696.
  if (host.length === 0 || host.length > 255) {
    return false;
  }
  // Host cannot start or end with a '-'
  if (host[0] === '-' || host.slice(-1) === '-') {
    return false;
  }
  // Host cannot start or end with a '_'
  if (host[0] === '_' || host.slice(-1) === '_') {
    return false;
  }
  // Host cannot start with a '.'
  if (host[0] === '.') {
    return false;
  }
  const alphaNumerics = '`~!@#$%^&*()+={}[]|\\"\';:><?/';
  // All non alphanumeric characters are invalid.
  for (const char of alphaNumerics) {
    if (host.includes(char)) {
      return false;
    }
  }
  // No need to regexp match, since the list is non-exhaustive.
  // We let it be valid and fail later.
  return true;
}

/**
 * Probes contentType using file extensions.
 *
 * @example
 * ```
 * // return 'image/png'
 * probeContentType('file.png')
 * ```
 */
export function probeContentType(path) {
  let contentType = mime.lookup(path);
  if (!contentType) {
    contentType = 'application/octet-stream';
  }
  return contentType;
}

/**
 * is input port valid.
 */
export function isValidPort(port) {
  // verify if port is a number.
  if (!isNumber(port)) {
    return false;
  }

  // port `0` is valid and special case
  return 0 <= port && port <= 65535;
}
export function isValidBucketName(bucket) {
  if (!isString(bucket)) {
    return false;
  }

  // bucket length should be less than and no more than 63
  // characters long.
  if (bucket.length < 3 || bucket.length > 63) {
    return false;
  }
  // bucket with successive periods is invalid.
  if (bucket.includes('..')) {
    return false;
  }
  // bucket cannot have ip address style.
  if (/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/.test(bucket)) {
    return false;
  }
  // bucket should begin with alphabet/number and end with alphabet/number,
  // with alphabet/number/.- in the middle.
  if (/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/.test(bucket)) {
    return true;
  }
  return false;
}

/**
 * check if objectName is a valid object name
 */
export function isValidObjectName(objectName) {
  if (!isValidPrefix(objectName)) {
    return false;
  }
  return objectName.length !== 0;
}

/**
 * check if prefix is valid
 */
export function isValidPrefix(prefix) {
  if (!isString(prefix)) {
    return false;
  }
  if (prefix.length > 1024) {
    return false;
  }
  return true;
}

/**
 * check if typeof arg number
 */
export function isNumber(arg) {
  return typeof arg === 'number';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any

/**
 * check if typeof arg function
 */
export function isFunction(arg) {
  return typeof arg === 'function';
}

/**
 * check if typeof arg string
 */
export function isString(arg) {
  return typeof arg === 'string';
}

/**
 * check if typeof arg object
 */
export function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

/**
 * check if object is readable stream
 */
export function isReadableStream(arg) {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  return isObject(arg) && isFunction(arg._read);
}

/**
 * check if arg is boolean
 */
export function isBoolean(arg) {
  return typeof arg === 'boolean';
}
export function isEmpty(o) {
  return _.isEmpty(o);
}
export function isEmptyObject(o) {
  return Object.values(o).filter(x => x !== undefined).length !== 0;
}
export function isDefined(o) {
  return o !== null && o !== undefined;
}

/**
 * check if arg is a valid date
 */
export function isValidDate(arg) {
  // @ts-expect-error checknew Date(Math.NaN)
  return arg instanceof Date && !isNaN(arg);
}

/**
 * Create a Date string with format: 'YYYYMMDDTHHmmss' + Z
 */
export function makeDateLong(date) {
  date = date || new Date();

  // Gives format like: '2017-08-07T16:28:59.889Z'
  const s = date.toISOString();
  return s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 13) + s.slice(14, 16) + s.slice(17, 19) + 'Z';
}

/**
 * Create a Date string with format: 'YYYYMMDD'
 */
export function makeDateShort(date) {
  date = date || new Date();

  // Gives format like: '2017-08-07T16:28:59.889Z'
  const s = date.toISOString();
  return s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 10);
}

/**
 * pipesetup sets up pipe() from left to right os streams array
 * pipesetup will also make sure that error emitted at any of the upstream Stream
 * will be emitted at the last stream. This makes error handling simple
 */
export function pipesetup(...streams) {
  // @ts-expect-error ts can't narrow this
  return streams.reduce((src, dst) => {
    src.on('error', err => dst.emit('error', err));
    return src.pipe(dst);
  });
}

/**
 * return a Readable stream that emits data
 */
export function readableStream(data) {
  const s = new stream.Readable();
  s._read = () => {};
  s.push(data);
  s.push(null);
  return s;
}

/**
 * Process metadata to insert appropriate value to `content-type` attribute
 */
export function insertContentType(metaData, filePath) {
  // check if content-type attribute present in metaData
  for (const key in metaData) {
    if (key.toLowerCase() === 'content-type') {
      return metaData;
    }
  }

  // if `content-type` attribute is not present in metadata, then infer it from the extension in filePath
  return {
    ...metaData,
    'content-type': probeContentType(filePath)
  };
}

/**
 * Function prepends metadata with the appropriate prefix if it is not already on
 */
export function prependXAMZMeta(metaData) {
  if (!metaData) {
    return {};
  }
  return _.mapKeys(metaData, (value, key) => {
    if (isAmzHeader(key) || isSupportedHeader(key) || isStorageClassHeader(key)) {
      return key;
    }
    return MetaDataHeaderPrefix + key;
  });
}

/**
 * Checks if it is a valid header according to the AmazonS3 API
 */
export function isAmzHeader(key) {
  const temp = key.toLowerCase();
  return temp.startsWith(MetaDataHeaderPrefix) || temp === 'x-amz-acl' || temp.startsWith('x-amz-server-side-encryption-') || temp === 'x-amz-server-side-encryption';
}

/**
 * Checks if it is a supported Header
 */
export function isSupportedHeader(key) {
  const supported_headers = ['content-type', 'cache-control', 'content-encoding', 'content-disposition', 'content-language', 'x-amz-website-redirect-location'];
  return supported_headers.includes(key.toLowerCase());
}

/**
 * Checks if it is a storage header
 */
export function isStorageClassHeader(key) {
  return key.toLowerCase() === 'x-amz-storage-class';
}
export function extractMetadata(headers) {
  return _.mapKeys(_.pickBy(headers, (value, key) => isSupportedHeader(key) || isStorageClassHeader(key) || isAmzHeader(key)), (value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith(MetaDataHeaderPrefix)) {
      return lower.slice(MetaDataHeaderPrefix.length);
    }
    return key;
  });
}
export function getVersionId(headers = {}) {
  return headers['x-amz-version-id'] || null;
}
export function getSourceVersionId(headers = {}) {
  return headers['x-amz-copy-source-version-id'] || null;
}
export function sanitizeETag(etag = '') {
  const replaceChars = {
    '"': '',
    '&quot;': '',
    '&#34;': '',
    '&QUOT;': '',
    '&#x00022': ''
  };
  return etag.replace(/^("|&quot;|&#34;)|("|&quot;|&#34;)$/g, m => replaceChars[m]);
}
export function toMd5(payload) {
  // use string from browser and buffer from nodejs
  // browser support is tested only against minio server
  return crypto.createHash('md5').update(Buffer.from(payload)).digest().toString('base64');
}
export function toSha256(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * toArray returns a single element array with param being the element,
 * if param is just a string, and returns 'param' back if it is an array
 * So, it makes sure param is always an array
 */
export function toArray(param) {
  if (!Array.isArray(param)) {
    return [param];
  }
  return param;
}
export function sanitizeObjectKey(objectName) {
  // + symbol characters are not decoded as spaces in JS. so replace them first and decode to get the correct result.
  const asStrName = (objectName ? objectName.toString() : '').replace(/\+/g, ' ');
  return decodeURIComponent(asStrName);
}
export function sanitizeSize(size) {
  return size ? Number.parseInt(size) : undefined;
}
export const PART_CONSTRAINTS = {
  // absMinPartSize - absolute minimum part size (5 MiB)
  ABS_MIN_PART_SIZE: 1024 * 1024 * 5,
  // MIN_PART_SIZE - minimum part size 16MiB per object after which
  MIN_PART_SIZE: 1024 * 1024 * 16,
  // MAX_PARTS_COUNT - maximum number of parts for a single multipart session.
  MAX_PARTS_COUNT: 10000,
  // MAX_PART_SIZE - maximum part size 5GiB for a single multipart upload
  // operation.
  MAX_PART_SIZE: 1024 * 1024 * 1024 * 5,
  // MAX_SINGLE_PUT_OBJECT_SIZE - maximum size 5GiB of object per PUT
  // operation.
  MAX_SINGLE_PUT_OBJECT_SIZE: 1024 * 1024 * 1024 * 5,
  // MAX_MULTIPART_PUT_OBJECT_SIZE - maximum size 5TiB of object for
  // Multipart operation.
  MAX_MULTIPART_PUT_OBJECT_SIZE: 1024 * 1024 * 1024 * 1024 * 5
};
const GENERIC_SSE_HEADER = 'X-Amz-Server-Side-Encryption';
const ENCRYPTION_HEADERS = {
  // sseGenericHeader is the AWS SSE header used for SSE-S3 and SSE-KMS.
  sseGenericHeader: GENERIC_SSE_HEADER,
  // sseKmsKeyID is the AWS SSE-KMS key id.
  sseKmsKeyID: GENERIC_SSE_HEADER + '-Aws-Kms-Key-Id'
};

/**
 * Return Encryption headers
 * @param encConfig
 * @returns an object with key value pairs that can be used in headers.
 */
export function getEncryptionHeaders(encConfig) {
  const encType = encConfig.type;
  if (!isEmpty(encType)) {
    if (encType === ENCRYPTION_TYPES.SSEC) {
      return {
        [ENCRYPTION_HEADERS.sseGenericHeader]: 'AES256'
      };
    } else if (encType === ENCRYPTION_TYPES.KMS) {
      return {
        [ENCRYPTION_HEADERS.sseGenericHeader]: encConfig.SSEAlgorithm,
        [ENCRYPTION_HEADERS.sseKmsKeyID]: encConfig.KMSMasterKeyID
      };
    }
  }
  return {};
}
export function partsRequired(size) {
  const maxPartSize = PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE / (PART_CONSTRAINTS.MAX_PARTS_COUNT - 1);
  let requiredPartSize = size / maxPartSize;
  if (size % maxPartSize > 0) {
    requiredPartSize++;
  }
  requiredPartSize = Math.trunc(requiredPartSize);
  return requiredPartSize;
}

/**
 * calculateEvenSplits - computes splits for a source and returns
 * start and end index slices. Splits happen evenly to be sure that no
 * part is less than 5MiB, as that could fail the multipart request if
 * it is not the last part.
 */
export function calculateEvenSplits(size, objInfo) {
  if (size === 0) {
    return null;
  }
  const reqParts = partsRequired(size);
  const startIndexParts = [];
  const endIndexParts = [];
  let start = objInfo.Start;
  if (isEmpty(start) || start === -1) {
    start = 0;
  }
  const divisorValue = Math.trunc(size / reqParts);
  const reminderValue = size % reqParts;
  let nextStart = start;
  for (let i = 0; i < reqParts; i++) {
    let curPartSize = divisorValue;
    if (i < reminderValue) {
      curPartSize++;
    }
    const currentStart = nextStart;
    const currentEnd = currentStart + curPartSize - 1;
    nextStart = currentEnd + 1;
    startIndexParts.push(currentStart);
    endIndexParts.push(currentEnd);
  }
  return {
    startIndex: startIndexParts,
    endIndex: endIndexParts,
    objInfo: objInfo
  };
}
const fxp = new XMLParser();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseXml(xml) {
  const result = fxp.parse(xml);
  if (result.Error) {
    throw result.Error;
  }
  return result;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJzdHJlYW0iLCJYTUxQYXJzZXIiLCJpcGFkZHIiLCJfIiwibWltZSIsIkVOQ1JZUFRJT05fVFlQRVMiLCJNZXRhRGF0YUhlYWRlclByZWZpeCIsInVyaUVzY2FwZSIsInN0cmluZyIsInNwbGl0IiwicmVkdWNlIiwiYWNjIiwiZWxlbSIsImJ1ZiIsIkJ1ZmZlciIsImZyb20iLCJsZW5ndGgiLCJjaGFyIiwidG9TdHJpbmciLCJ0b1VwcGVyQ2FzZSIsInVyaVJlc291cmNlRXNjYXBlIiwicmVwbGFjZSIsImdldFNjb3BlIiwicmVnaW9uIiwiZGF0ZSIsInNlcnZpY2VOYW1lIiwibWFrZURhdGVTaG9ydCIsImlzQW1hem9uRW5kcG9pbnQiLCJlbmRwb2ludCIsImlzVmlydHVhbEhvc3RTdHlsZSIsInByb3RvY29sIiwiYnVja2V0IiwicGF0aFN0eWxlIiwiaW5jbHVkZXMiLCJpc1ZhbGlkSVAiLCJpcCIsImlzVmFsaWQiLCJpc1ZhbGlkRW5kcG9pbnQiLCJpc1ZhbGlkRG9tYWluIiwiaG9zdCIsImlzU3RyaW5nIiwic2xpY2UiLCJhbHBoYU51bWVyaWNzIiwicHJvYmVDb250ZW50VHlwZSIsInBhdGgiLCJjb250ZW50VHlwZSIsImxvb2t1cCIsImlzVmFsaWRQb3J0IiwicG9ydCIsImlzTnVtYmVyIiwiaXNWYWxpZEJ1Y2tldE5hbWUiLCJ0ZXN0IiwiaXNWYWxpZE9iamVjdE5hbWUiLCJvYmplY3ROYW1lIiwiaXNWYWxpZFByZWZpeCIsInByZWZpeCIsImFyZyIsImlzRnVuY3Rpb24iLCJpc09iamVjdCIsImlzUmVhZGFibGVTdHJlYW0iLCJfcmVhZCIsImlzQm9vbGVhbiIsImlzRW1wdHkiLCJvIiwiaXNFbXB0eU9iamVjdCIsIk9iamVjdCIsInZhbHVlcyIsImZpbHRlciIsIngiLCJ1bmRlZmluZWQiLCJpc0RlZmluZWQiLCJpc1ZhbGlkRGF0ZSIsIkRhdGUiLCJpc05hTiIsIm1ha2VEYXRlTG9uZyIsInMiLCJ0b0lTT1N0cmluZyIsInBpcGVzZXR1cCIsInN0cmVhbXMiLCJzcmMiLCJkc3QiLCJvbiIsImVyciIsImVtaXQiLCJwaXBlIiwicmVhZGFibGVTdHJlYW0iLCJkYXRhIiwiUmVhZGFibGUiLCJwdXNoIiwiaW5zZXJ0Q29udGVudFR5cGUiLCJtZXRhRGF0YSIsImZpbGVQYXRoIiwia2V5IiwidG9Mb3dlckNhc2UiLCJwcmVwZW5kWEFNWk1ldGEiLCJtYXBLZXlzIiwidmFsdWUiLCJpc0FtekhlYWRlciIsImlzU3VwcG9ydGVkSGVhZGVyIiwiaXNTdG9yYWdlQ2xhc3NIZWFkZXIiLCJ0ZW1wIiwic3RhcnRzV2l0aCIsInN1cHBvcnRlZF9oZWFkZXJzIiwiZXh0cmFjdE1ldGFkYXRhIiwiaGVhZGVycyIsInBpY2tCeSIsImxvd2VyIiwiZ2V0VmVyc2lvbklkIiwiZ2V0U291cmNlVmVyc2lvbklkIiwic2FuaXRpemVFVGFnIiwiZXRhZyIsInJlcGxhY2VDaGFycyIsIm0iLCJ0b01kNSIsInBheWxvYWQiLCJjcmVhdGVIYXNoIiwidXBkYXRlIiwiZGlnZXN0IiwidG9TaGEyNTYiLCJ0b0FycmF5IiwicGFyYW0iLCJBcnJheSIsImlzQXJyYXkiLCJzYW5pdGl6ZU9iamVjdEtleSIsImFzU3RyTmFtZSIsImRlY29kZVVSSUNvbXBvbmVudCIsInNhbml0aXplU2l6ZSIsInNpemUiLCJOdW1iZXIiLCJwYXJzZUludCIsIlBBUlRfQ09OU1RSQUlOVFMiLCJBQlNfTUlOX1BBUlRfU0laRSIsIk1JTl9QQVJUX1NJWkUiLCJNQVhfUEFSVFNfQ09VTlQiLCJNQVhfUEFSVF9TSVpFIiwiTUFYX1NJTkdMRV9QVVRfT0JKRUNUX1NJWkUiLCJNQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSIsIkdFTkVSSUNfU1NFX0hFQURFUiIsIkVOQ1JZUFRJT05fSEVBREVSUyIsInNzZUdlbmVyaWNIZWFkZXIiLCJzc2VLbXNLZXlJRCIsImdldEVuY3J5cHRpb25IZWFkZXJzIiwiZW5jQ29uZmlnIiwiZW5jVHlwZSIsInR5cGUiLCJTU0VDIiwiS01TIiwiU1NFQWxnb3JpdGhtIiwiS01TTWFzdGVyS2V5SUQiLCJwYXJ0c1JlcXVpcmVkIiwibWF4UGFydFNpemUiLCJyZXF1aXJlZFBhcnRTaXplIiwiTWF0aCIsInRydW5jIiwiY2FsY3VsYXRlRXZlblNwbGl0cyIsIm9iakluZm8iLCJyZXFQYXJ0cyIsInN0YXJ0SW5kZXhQYXJ0cyIsImVuZEluZGV4UGFydHMiLCJzdGFydCIsIlN0YXJ0IiwiZGl2aXNvclZhbHVlIiwicmVtaW5kZXJWYWx1ZSIsIm5leHRTdGFydCIsImkiLCJjdXJQYXJ0U2l6ZSIsImN1cnJlbnRTdGFydCIsImN1cnJlbnRFbmQiLCJzdGFydEluZGV4IiwiZW5kSW5kZXgiLCJmeHAiLCJwYXJzZVhtbCIsInhtbCIsInJlc3VsdCIsInBhcnNlIiwiRXJyb3IiXSwic291cmNlcyI6WyJoZWxwZXIudHMiXSwic291cmNlc0NvbnRlbnQiOlsiLypcbiAqIE1pbklPIEphdmFzY3JpcHQgTGlicmFyeSBmb3IgQW1hem9uIFMzIENvbXBhdGlibGUgQ2xvdWQgU3RvcmFnZSwgKEMpIDIwMTUgTWluSU8sIEluYy5cbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKi9cblxuaW1wb3J0ICogYXMgY3J5cHRvIGZyb20gJ25vZGU6Y3J5cHRvJ1xuaW1wb3J0ICogYXMgc3RyZWFtIGZyb20gJ25vZGU6c3RyZWFtJ1xuXG5pbXBvcnQgeyBYTUxQYXJzZXIgfSBmcm9tICdmYXN0LXhtbC1wYXJzZXInXG5pbXBvcnQgaXBhZGRyIGZyb20gJ2lwYWRkci5qcydcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCdcbmltcG9ydCAqIGFzIG1pbWUgZnJvbSAnbWltZS10eXBlcydcblxuaW1wb3J0IHR5cGUgeyBCaW5hcnksIEVuY3J5cHRpb24sIE9iamVjdE1ldGFEYXRhLCBSZXF1ZXN0SGVhZGVycywgUmVzcG9uc2VIZWFkZXIgfSBmcm9tICcuL3R5cGUudHMnXG5pbXBvcnQgeyBFTkNSWVBUSU9OX1RZUEVTIH0gZnJvbSAnLi90eXBlLnRzJ1xuXG5jb25zdCBNZXRhRGF0YUhlYWRlclByZWZpeCA9ICd4LWFtei1tZXRhLSdcblxuLyoqXG4gKiBBbGwgY2hhcmFjdGVycyBpbiBzdHJpbmcgd2hpY2ggYXJlIE5PVCB1bnJlc2VydmVkIHNob3VsZCBiZSBwZXJjZW50IGVuY29kZWQuXG4gKiBVbnJlc2VydmVkIGNoYXJhY3RlcnMgYXJlIDogQUxQSEEgLyBESUdJVCAvIFwiLVwiIC8gXCIuXCIgLyBcIl9cIiAvIFwiflwiXG4gKiBSZWZlcmVuY2UgaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzM5ODYjc2VjdGlvbi0yLjJcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVyaUVzY2FwZShzdHJpbmc6IHN0cmluZykge1xuICByZXR1cm4gc3RyaW5nLnNwbGl0KCcnKS5yZWR1Y2UoKGFjYzogc3RyaW5nLCBlbGVtOiBzdHJpbmcpID0+IHtcbiAgICBjb25zdCBidWYgPSBCdWZmZXIuZnJvbShlbGVtKVxuICAgIGlmIChidWYubGVuZ3RoID09PSAxKSB7XG4gICAgICAvLyBsZW5ndGggMSBpbmRpY2F0ZXMgdGhhdCBlbGVtIGlzIG5vdCBhIHVuaWNvZGUgY2hhcmFjdGVyLlxuICAgICAgLy8gQ2hlY2sgaWYgaXQgaXMgYW4gdW5yZXNlcnZlZCBjaGFyYWNlci5cbiAgICAgIGlmIChcbiAgICAgICAgKCdBJyA8PSBlbGVtICYmIGVsZW0gPD0gJ1onKSB8fFxuICAgICAgICAoJ2EnIDw9IGVsZW0gJiYgZWxlbSA8PSAneicpIHx8XG4gICAgICAgICgnMCcgPD0gZWxlbSAmJiBlbGVtIDw9ICc5JykgfHxcbiAgICAgICAgZWxlbSA9PT0gJ18nIHx8XG4gICAgICAgIGVsZW0gPT09ICcuJyB8fFxuICAgICAgICBlbGVtID09PSAnficgfHxcbiAgICAgICAgZWxlbSA9PT0gJy0nXG4gICAgICApIHtcbiAgICAgICAgLy8gVW5yZXNlcnZlZCBjaGFyYWNlciBzaG91bGQgbm90IGJlIGVuY29kZWQuXG4gICAgICAgIGFjYyA9IGFjYyArIGVsZW1cbiAgICAgICAgcmV0dXJuIGFjY1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBlbGVtIG5lZWRzIGVuY29kaW5nIC0gaS5lIGVsZW0gc2hvdWxkIGJlIGVuY29kZWQgaWYgaXQncyBub3QgdW5yZXNlcnZlZFxuICAgIC8vIGNoYXJhY3RlciBvciBpZiBpdCdzIGEgdW5pY29kZSBjaGFyYWN0ZXIuXG4gICAgZm9yIChjb25zdCBjaGFyIG9mIGJ1Zikge1xuICAgICAgYWNjID0gYWNjICsgJyUnICsgY2hhci50b1N0cmluZygxNikudG9VcHBlckNhc2UoKVxuICAgIH1cbiAgICByZXR1cm4gYWNjXG4gIH0sICcnKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdXJpUmVzb3VyY2VFc2NhcGUoc3RyaW5nOiBzdHJpbmcpIHtcbiAgcmV0dXJuIHVyaUVzY2FwZShzdHJpbmcpLnJlcGxhY2UoLyUyRi9nLCAnLycpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTY29wZShyZWdpb246IHN0cmluZywgZGF0ZTogRGF0ZSwgc2VydmljZU5hbWUgPSAnczMnKSB7XG4gIHJldHVybiBgJHttYWtlRGF0ZVNob3J0KGRhdGUpfS8ke3JlZ2lvbn0vJHtzZXJ2aWNlTmFtZX0vYXdzNF9yZXF1ZXN0YFxufVxuXG4vKipcbiAqIGlzQW1hem9uRW5kcG9pbnQgLSB0cnVlIGlmIGVuZHBvaW50IGlzICdzMy5hbWF6b25hd3MuY29tJyBvciAnczMuY24tbm9ydGgtMS5hbWF6b25hd3MuY29tLmNuJ1xuICovXG5leHBvcnQgZnVuY3Rpb24gaXNBbWF6b25FbmRwb2ludChlbmRwb2ludDogc3RyaW5nKSB7XG4gIHJldHVybiBlbmRwb2ludCA9PT0gJ3MzLmFtYXpvbmF3cy5jb20nIHx8IGVuZHBvaW50ID09PSAnczMuY24tbm9ydGgtMS5hbWF6b25hd3MuY29tLmNuJ1xufVxuXG4vKipcbiAqIGlzVmlydHVhbEhvc3RTdHlsZSAtIHZlcmlmeSBpZiBidWNrZXQgbmFtZSBpcyBzdXBwb3J0IHdpdGggdmlydHVhbFxuICogaG9zdHMuIGJ1Y2tldE5hbWVzIHdpdGggcGVyaW9kcyBzaG91bGQgYmUgYWx3YXlzIHRyZWF0ZWQgYXMgcGF0aFxuICogc3R5bGUgaWYgdGhlIHByb3RvY29sIGlzICdodHRwczonLCB0aGlzIGlzIGR1ZSB0byBTU0wgd2lsZGNhcmRcbiAqIGxpbWl0YXRpb24uIEZvciBhbGwgb3RoZXIgYnVja2V0cyBhbmQgQW1hem9uIFMzIGVuZHBvaW50IHdlIHdpbGxcbiAqIGRlZmF1bHQgdG8gdmlydHVhbCBob3N0IHN0eWxlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWaXJ0dWFsSG9zdFN0eWxlKGVuZHBvaW50OiBzdHJpbmcsIHByb3RvY29sOiBzdHJpbmcsIGJ1Y2tldDogc3RyaW5nLCBwYXRoU3R5bGU6IGJvb2xlYW4pIHtcbiAgaWYgKHByb3RvY29sID09PSAnaHR0cHM6JyAmJiBidWNrZXQuaW5jbHVkZXMoJy4nKSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIHJldHVybiBpc0FtYXpvbkVuZHBvaW50KGVuZHBvaW50KSB8fCAhcGF0aFN0eWxlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkSVAoaXA6IHN0cmluZykge1xuICByZXR1cm4gaXBhZGRyLmlzVmFsaWQoaXApXG59XG5cbi8qKlxuICogQHJldHVybnMgaWYgZW5kcG9pbnQgaXMgdmFsaWQgZG9tYWluLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZEVuZHBvaW50KGVuZHBvaW50OiBzdHJpbmcpIHtcbiAgcmV0dXJuIGlzVmFsaWREb21haW4oZW5kcG9pbnQpIHx8IGlzVmFsaWRJUChlbmRwb2ludClcbn1cblxuLyoqXG4gKiBAcmV0dXJucyBpZiBpbnB1dCBob3N0IGlzIGEgdmFsaWQgZG9tYWluLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZERvbWFpbihob3N0OiBzdHJpbmcpIHtcbiAgaWYgKCFpc1N0cmluZyhob3N0KSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIFNlZSBSRkMgMTAzNSwgUkZDIDM2OTYuXG4gIGlmIChob3N0Lmxlbmd0aCA9PT0gMCB8fCBob3N0Lmxlbmd0aCA+IDI1NSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIEhvc3QgY2Fubm90IHN0YXJ0IG9yIGVuZCB3aXRoIGEgJy0nXG4gIGlmIChob3N0WzBdID09PSAnLScgfHwgaG9zdC5zbGljZSgtMSkgPT09ICctJykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIEhvc3QgY2Fubm90IHN0YXJ0IG9yIGVuZCB3aXRoIGEgJ18nXG4gIGlmIChob3N0WzBdID09PSAnXycgfHwgaG9zdC5zbGljZSgtMSkgPT09ICdfJykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIEhvc3QgY2Fubm90IHN0YXJ0IHdpdGggYSAnLidcbiAgaWYgKGhvc3RbMF0gPT09ICcuJykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgY29uc3QgYWxwaGFOdW1lcmljcyA9ICdgfiFAIyQlXiYqKCkrPXt9W118XFxcXFwiXFwnOzo+PD8vJ1xuICAvLyBBbGwgbm9uIGFscGhhbnVtZXJpYyBjaGFyYWN0ZXJzIGFyZSBpbnZhbGlkLlxuICBmb3IgKGNvbnN0IGNoYXIgb2YgYWxwaGFOdW1lcmljcykge1xuICAgIGlmIChob3N0LmluY2x1ZGVzKGNoYXIpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gIH1cbiAgLy8gTm8gbmVlZCB0byByZWdleHAgbWF0Y2gsIHNpbmNlIHRoZSBsaXN0IGlzIG5vbi1leGhhdXN0aXZlLlxuICAvLyBXZSBsZXQgaXQgYmUgdmFsaWQgYW5kIGZhaWwgbGF0ZXIuXG4gIHJldHVybiB0cnVlXG59XG5cbi8qKlxuICogUHJvYmVzIGNvbnRlbnRUeXBlIHVzaW5nIGZpbGUgZXh0ZW5zaW9ucy5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgXG4gKiAvLyByZXR1cm4gJ2ltYWdlL3BuZydcbiAqIHByb2JlQ29udGVudFR5cGUoJ2ZpbGUucG5nJylcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJvYmVDb250ZW50VHlwZShwYXRoOiBzdHJpbmcpIHtcbiAgbGV0IGNvbnRlbnRUeXBlID0gbWltZS5sb29rdXAocGF0aClcbiAgaWYgKCFjb250ZW50VHlwZSkge1xuICAgIGNvbnRlbnRUeXBlID0gJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSdcbiAgfVxuICByZXR1cm4gY29udGVudFR5cGVcbn1cblxuLyoqXG4gKiBpcyBpbnB1dCBwb3J0IHZhbGlkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZFBvcnQocG9ydDogdW5rbm93bik6IHBvcnQgaXMgbnVtYmVyIHtcbiAgLy8gdmVyaWZ5IGlmIHBvcnQgaXMgYSBudW1iZXIuXG4gIGlmICghaXNOdW1iZXIocG9ydCkpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIHBvcnQgYDBgIGlzIHZhbGlkIGFuZCBzcGVjaWFsIGNhc2VcbiAgcmV0dXJuIDAgPD0gcG9ydCAmJiBwb3J0IDw9IDY1NTM1XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkQnVja2V0TmFtZShidWNrZXQ6IHVua25vd24pIHtcbiAgaWYgKCFpc1N0cmluZyhidWNrZXQpKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvLyBidWNrZXQgbGVuZ3RoIHNob3VsZCBiZSBsZXNzIHRoYW4gYW5kIG5vIG1vcmUgdGhhbiA2M1xuICAvLyBjaGFyYWN0ZXJzIGxvbmcuXG4gIGlmIChidWNrZXQubGVuZ3RoIDwgMyB8fCBidWNrZXQubGVuZ3RoID4gNjMpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuICAvLyBidWNrZXQgd2l0aCBzdWNjZXNzaXZlIHBlcmlvZHMgaXMgaW52YWxpZC5cbiAgaWYgKGJ1Y2tldC5pbmNsdWRlcygnLi4nKSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIGJ1Y2tldCBjYW5ub3QgaGF2ZSBpcCBhZGRyZXNzIHN0eWxlLlxuICBpZiAoL1swLTldK1xcLlswLTldK1xcLlswLTldK1xcLlswLTldKy8udGVzdChidWNrZXQpKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgLy8gYnVja2V0IHNob3VsZCBiZWdpbiB3aXRoIGFscGhhYmV0L251bWJlciBhbmQgZW5kIHdpdGggYWxwaGFiZXQvbnVtYmVyLFxuICAvLyB3aXRoIGFscGhhYmV0L251bWJlci8uLSBpbiB0aGUgbWlkZGxlLlxuICBpZiAoL15bYS16MC05XVthLXowLTkuLV0rW2EtejAtOV0kLy50ZXN0KGJ1Y2tldCkpIHtcbiAgICByZXR1cm4gdHJ1ZVxuICB9XG4gIHJldHVybiBmYWxzZVxufVxuXG4vKipcbiAqIGNoZWNrIGlmIG9iamVjdE5hbWUgaXMgYSB2YWxpZCBvYmplY3QgbmFtZVxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZTogdW5rbm93bikge1xuICBpZiAoIWlzVmFsaWRQcmVmaXgob2JqZWN0TmFtZSkpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIHJldHVybiBvYmplY3ROYW1lLmxlbmd0aCAhPT0gMFxufVxuXG4vKipcbiAqIGNoZWNrIGlmIHByZWZpeCBpcyB2YWxpZFxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZFByZWZpeChwcmVmaXg6IHVua25vd24pOiBwcmVmaXggaXMgc3RyaW5nIHtcbiAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgaWYgKHByZWZpeC5sZW5ndGggPiAxMDI0KSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgcmV0dXJuIHRydWVcbn1cblxuLyoqXG4gKiBjaGVjayBpZiB0eXBlb2YgYXJnIG51bWJlclxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNOdW1iZXIoYXJnOiB1bmtub3duKTogYXJnIGlzIG51bWJlciB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnbnVtYmVyJ1xufVxuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLWV4cGxpY2l0LWFueVxuZXhwb3J0IHR5cGUgQW55RnVuY3Rpb24gPSAoLi4uYXJnczogYW55W10pID0+IGFueVxuXG4vKipcbiAqIGNoZWNrIGlmIHR5cGVvZiBhcmcgZnVuY3Rpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRnVuY3Rpb24oYXJnOiB1bmtub3duKTogYXJnIGlzIEFueUZ1bmN0aW9uIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdmdW5jdGlvbidcbn1cblxuLyoqXG4gKiBjaGVjayBpZiB0eXBlb2YgYXJnIHN0cmluZ1xuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTdHJpbmcoYXJnOiB1bmtub3duKTogYXJnIGlzIHN0cmluZyB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnc3RyaW5nJ1xufVxuXG4vKipcbiAqIGNoZWNrIGlmIHR5cGVvZiBhcmcgb2JqZWN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc09iamVjdChhcmc6IHVua25vd24pOiBhcmcgaXMgb2JqZWN0IHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdvYmplY3QnICYmIGFyZyAhPT0gbnVsbFxufVxuXG4vKipcbiAqIGNoZWNrIGlmIG9iamVjdCBpcyByZWFkYWJsZSBzdHJlYW1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzUmVhZGFibGVTdHJlYW0oYXJnOiB1bmtub3duKTogYXJnIGlzIHN0cmVhbS5SZWFkYWJsZSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvdW5ib3VuZC1tZXRob2RcbiAgcmV0dXJuIGlzT2JqZWN0KGFyZykgJiYgaXNGdW5jdGlvbigoYXJnIGFzIHN0cmVhbS5SZWFkYWJsZSkuX3JlYWQpXG59XG5cbi8qKlxuICogY2hlY2sgaWYgYXJnIGlzIGJvb2xlYW5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzQm9vbGVhbihhcmc6IHVua25vd24pOiBhcmcgaXMgYm9vbGVhbiB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnYm9vbGVhbidcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzRW1wdHkobzogdW5rbm93bik6IG8gaXMgbnVsbCB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBfLmlzRW1wdHkobylcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzRW1wdHlPYmplY3QobzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBib29sZWFuIHtcbiAgcmV0dXJuIE9iamVjdC52YWx1ZXMobykuZmlsdGVyKCh4KSA9PiB4ICE9PSB1bmRlZmluZWQpLmxlbmd0aCAhPT0gMFxufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNEZWZpbmVkPFQ+KG86IFQpOiBvIGlzIEV4Y2x1ZGU8VCwgbnVsbCB8IHVuZGVmaW5lZD4ge1xuICByZXR1cm4gbyAhPT0gbnVsbCAmJiBvICE9PSB1bmRlZmluZWRcbn1cblxuLyoqXG4gKiBjaGVjayBpZiBhcmcgaXMgYSB2YWxpZCBkYXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkRGF0ZShhcmc6IHVua25vd24pOiBhcmcgaXMgRGF0ZSB7XG4gIC8vIEB0cy1leHBlY3QtZXJyb3IgY2hlY2tuZXcgRGF0ZShNYXRoLk5hTilcbiAgcmV0dXJuIGFyZyBpbnN0YW5jZW9mIERhdGUgJiYgIWlzTmFOKGFyZylcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBEYXRlIHN0cmluZyB3aXRoIGZvcm1hdDogJ1lZWVlNTUREVEhIbW1zcycgKyBaXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYWtlRGF0ZUxvbmcoZGF0ZT86IERhdGUpOiBzdHJpbmcge1xuICBkYXRlID0gZGF0ZSB8fCBuZXcgRGF0ZSgpXG5cbiAgLy8gR2l2ZXMgZm9ybWF0IGxpa2U6ICcyMDE3LTA4LTA3VDE2OjI4OjU5Ljg4OVonXG4gIGNvbnN0IHMgPSBkYXRlLnRvSVNPU3RyaW5nKClcblxuICByZXR1cm4gcy5zbGljZSgwLCA0KSArIHMuc2xpY2UoNSwgNykgKyBzLnNsaWNlKDgsIDEzKSArIHMuc2xpY2UoMTQsIDE2KSArIHMuc2xpY2UoMTcsIDE5KSArICdaJ1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIERhdGUgc3RyaW5nIHdpdGggZm9ybWF0OiAnWVlZWU1NREQnXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYWtlRGF0ZVNob3J0KGRhdGU/OiBEYXRlKSB7XG4gIGRhdGUgPSBkYXRlIHx8IG5ldyBEYXRlKClcblxuICAvLyBHaXZlcyBmb3JtYXQgbGlrZTogJzIwMTctMDgtMDdUMTY6Mjg6NTkuODg5WidcbiAgY29uc3QgcyA9IGRhdGUudG9JU09TdHJpbmcoKVxuXG4gIHJldHVybiBzLnNsaWNlKDAsIDQpICsgcy5zbGljZSg1LCA3KSArIHMuc2xpY2UoOCwgMTApXG59XG5cbi8qKlxuICogcGlwZXNldHVwIHNldHMgdXAgcGlwZSgpIGZyb20gbGVmdCB0byByaWdodCBvcyBzdHJlYW1zIGFycmF5XG4gKiBwaXBlc2V0dXAgd2lsbCBhbHNvIG1ha2Ugc3VyZSB0aGF0IGVycm9yIGVtaXR0ZWQgYXQgYW55IG9mIHRoZSB1cHN0cmVhbSBTdHJlYW1cbiAqIHdpbGwgYmUgZW1pdHRlZCBhdCB0aGUgbGFzdCBzdHJlYW0uIFRoaXMgbWFrZXMgZXJyb3IgaGFuZGxpbmcgc2ltcGxlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwaXBlc2V0dXAoLi4uc3RyZWFtczogW3N0cmVhbS5SZWFkYWJsZSwgLi4uc3RyZWFtLkR1cGxleFtdLCBzdHJlYW0uV3JpdGFibGVdKSB7XG4gIC8vIEB0cy1leHBlY3QtZXJyb3IgdHMgY2FuJ3QgbmFycm93IHRoaXNcbiAgcmV0dXJuIHN0cmVhbXMucmVkdWNlKChzcmM6IHN0cmVhbS5SZWFkYWJsZSwgZHN0OiBzdHJlYW0uV3JpdGFibGUpID0+IHtcbiAgICBzcmMub24oJ2Vycm9yJywgKGVycikgPT4gZHN0LmVtaXQoJ2Vycm9yJywgZXJyKSlcbiAgICByZXR1cm4gc3JjLnBpcGUoZHN0KVxuICB9KVxufVxuXG4vKipcbiAqIHJldHVybiBhIFJlYWRhYmxlIHN0cmVhbSB0aGF0IGVtaXRzIGRhdGFcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlYWRhYmxlU3RyZWFtKGRhdGE6IHVua25vd24pOiBzdHJlYW0uUmVhZGFibGUge1xuICBjb25zdCBzID0gbmV3IHN0cmVhbS5SZWFkYWJsZSgpXG4gIHMuX3JlYWQgPSAoKSA9PiB7fVxuICBzLnB1c2goZGF0YSlcbiAgcy5wdXNoKG51bGwpXG4gIHJldHVybiBzXG59XG5cbi8qKlxuICogUHJvY2VzcyBtZXRhZGF0YSB0byBpbnNlcnQgYXBwcm9wcmlhdGUgdmFsdWUgdG8gYGNvbnRlbnQtdHlwZWAgYXR0cmlidXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpbnNlcnRDb250ZW50VHlwZShtZXRhRGF0YTogT2JqZWN0TWV0YURhdGEsIGZpbGVQYXRoOiBzdHJpbmcpOiBPYmplY3RNZXRhRGF0YSB7XG4gIC8vIGNoZWNrIGlmIGNvbnRlbnQtdHlwZSBhdHRyaWJ1dGUgcHJlc2VudCBpbiBtZXRhRGF0YVxuICBmb3IgKGNvbnN0IGtleSBpbiBtZXRhRGF0YSkge1xuICAgIGlmIChrZXkudG9Mb3dlckNhc2UoKSA9PT0gJ2NvbnRlbnQtdHlwZScpIHtcbiAgICAgIHJldHVybiBtZXRhRGF0YVxuICAgIH1cbiAgfVxuXG4gIC8vIGlmIGBjb250ZW50LXR5cGVgIGF0dHJpYnV0ZSBpcyBub3QgcHJlc2VudCBpbiBtZXRhZGF0YSwgdGhlbiBpbmZlciBpdCBmcm9tIHRoZSBleHRlbnNpb24gaW4gZmlsZVBhdGhcbiAgcmV0dXJuIHtcbiAgICAuLi5tZXRhRGF0YSxcbiAgICAnY29udGVudC10eXBlJzogcHJvYmVDb250ZW50VHlwZShmaWxlUGF0aCksXG4gIH1cbn1cblxuLyoqXG4gKiBGdW5jdGlvbiBwcmVwZW5kcyBtZXRhZGF0YSB3aXRoIHRoZSBhcHByb3ByaWF0ZSBwcmVmaXggaWYgaXQgaXMgbm90IGFscmVhZHkgb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHByZXBlbmRYQU1aTWV0YShtZXRhRGF0YT86IE9iamVjdE1ldGFEYXRhKTogUmVxdWVzdEhlYWRlcnMge1xuICBpZiAoIW1ldGFEYXRhKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICByZXR1cm4gXy5tYXBLZXlzKG1ldGFEYXRhLCAodmFsdWUsIGtleSkgPT4ge1xuICAgIGlmIChpc0FtekhlYWRlcihrZXkpIHx8IGlzU3VwcG9ydGVkSGVhZGVyKGtleSkgfHwgaXNTdG9yYWdlQ2xhc3NIZWFkZXIoa2V5KSkge1xuICAgICAgcmV0dXJuIGtleVxuICAgIH1cblxuICAgIHJldHVybiBNZXRhRGF0YUhlYWRlclByZWZpeCArIGtleVxuICB9KVxufVxuXG4vKipcbiAqIENoZWNrcyBpZiBpdCBpcyBhIHZhbGlkIGhlYWRlciBhY2NvcmRpbmcgdG8gdGhlIEFtYXpvblMzIEFQSVxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNBbXpIZWFkZXIoa2V5OiBzdHJpbmcpIHtcbiAgY29uc3QgdGVtcCA9IGtleS50b0xvd2VyQ2FzZSgpXG4gIHJldHVybiAoXG4gICAgdGVtcC5zdGFydHNXaXRoKE1ldGFEYXRhSGVhZGVyUHJlZml4KSB8fFxuICAgIHRlbXAgPT09ICd4LWFtei1hY2wnIHx8XG4gICAgdGVtcC5zdGFydHNXaXRoKCd4LWFtei1zZXJ2ZXItc2lkZS1lbmNyeXB0aW9uLScpIHx8XG4gICAgdGVtcCA9PT0gJ3gtYW16LXNlcnZlci1zaWRlLWVuY3J5cHRpb24nXG4gIClcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgaXQgaXMgYSBzdXBwb3J0ZWQgSGVhZGVyXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1N1cHBvcnRlZEhlYWRlcihrZXk6IHN0cmluZykge1xuICBjb25zdCBzdXBwb3J0ZWRfaGVhZGVycyA9IFtcbiAgICAnY29udGVudC10eXBlJyxcbiAgICAnY2FjaGUtY29udHJvbCcsXG4gICAgJ2NvbnRlbnQtZW5jb2RpbmcnLFxuICAgICdjb250ZW50LWRpc3Bvc2l0aW9uJyxcbiAgICAnY29udGVudC1sYW5ndWFnZScsXG4gICAgJ3gtYW16LXdlYnNpdGUtcmVkaXJlY3QtbG9jYXRpb24nLFxuICBdXG4gIHJldHVybiBzdXBwb3J0ZWRfaGVhZGVycy5pbmNsdWRlcyhrZXkudG9Mb3dlckNhc2UoKSlcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgaXQgaXMgYSBzdG9yYWdlIGhlYWRlclxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTdG9yYWdlQ2xhc3NIZWFkZXIoa2V5OiBzdHJpbmcpIHtcbiAgcmV0dXJuIGtleS50b0xvd2VyQ2FzZSgpID09PSAneC1hbXotc3RvcmFnZS1jbGFzcydcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RNZXRhZGF0YShoZWFkZXJzOiBSZXNwb25zZUhlYWRlcikge1xuICByZXR1cm4gXy5tYXBLZXlzKFxuICAgIF8ucGlja0J5KGhlYWRlcnMsICh2YWx1ZSwga2V5KSA9PiBpc1N1cHBvcnRlZEhlYWRlcihrZXkpIHx8IGlzU3RvcmFnZUNsYXNzSGVhZGVyKGtleSkgfHwgaXNBbXpIZWFkZXIoa2V5KSksXG4gICAgKHZhbHVlLCBrZXkpID0+IHtcbiAgICAgIGNvbnN0IGxvd2VyID0ga2V5LnRvTG93ZXJDYXNlKClcbiAgICAgIGlmIChsb3dlci5zdGFydHNXaXRoKE1ldGFEYXRhSGVhZGVyUHJlZml4KSkge1xuICAgICAgICByZXR1cm4gbG93ZXIuc2xpY2UoTWV0YURhdGFIZWFkZXJQcmVmaXgubGVuZ3RoKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4ga2V5XG4gICAgfSxcbiAgKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0VmVyc2lvbklkKGhlYWRlcnM6IFJlc3BvbnNlSGVhZGVyID0ge30pIHtcbiAgcmV0dXJuIGhlYWRlcnNbJ3gtYW16LXZlcnNpb24taWQnXSB8fCBudWxsXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTb3VyY2VWZXJzaW9uSWQoaGVhZGVyczogUmVzcG9uc2VIZWFkZXIgPSB7fSkge1xuICByZXR1cm4gaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtdmVyc2lvbi1pZCddIHx8IG51bGxcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplRVRhZyhldGFnID0gJycpOiBzdHJpbmcge1xuICBjb25zdCByZXBsYWNlQ2hhcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgJ1wiJzogJycsXG4gICAgJyZxdW90Oyc6ICcnLFxuICAgICcmIzM0Oyc6ICcnLFxuICAgICcmUVVPVDsnOiAnJyxcbiAgICAnJiN4MDAwMjInOiAnJyxcbiAgfVxuICByZXR1cm4gZXRhZy5yZXBsYWNlKC9eKFwifCZxdW90O3wmIzM0Oyl8KFwifCZxdW90O3wmIzM0OykkL2csIChtKSA9PiByZXBsYWNlQ2hhcnNbbV0gYXMgc3RyaW5nKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdG9NZDUocGF5bG9hZDogQmluYXJ5KTogc3RyaW5nIHtcbiAgLy8gdXNlIHN0cmluZyBmcm9tIGJyb3dzZXIgYW5kIGJ1ZmZlciBmcm9tIG5vZGVqc1xuICAvLyBicm93c2VyIHN1cHBvcnQgaXMgdGVzdGVkIG9ubHkgYWdhaW5zdCBtaW5pbyBzZXJ2ZXJcbiAgcmV0dXJuIGNyeXB0by5jcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoQnVmZmVyLmZyb20ocGF5bG9hZCkpLmRpZ2VzdCgpLnRvU3RyaW5nKCdiYXNlNjQnKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdG9TaGEyNTYocGF5bG9hZDogQmluYXJ5KTogc3RyaW5nIHtcbiAgcmV0dXJuIGNyeXB0by5jcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUocGF5bG9hZCkuZGlnZXN0KCdoZXgnKVxufVxuXG4vKipcbiAqIHRvQXJyYXkgcmV0dXJucyBhIHNpbmdsZSBlbGVtZW50IGFycmF5IHdpdGggcGFyYW0gYmVpbmcgdGhlIGVsZW1lbnQsXG4gKiBpZiBwYXJhbSBpcyBqdXN0IGEgc3RyaW5nLCBhbmQgcmV0dXJucyAncGFyYW0nIGJhY2sgaWYgaXQgaXMgYW4gYXJyYXlcbiAqIFNvLCBpdCBtYWtlcyBzdXJlIHBhcmFtIGlzIGFsd2F5cyBhbiBhcnJheVxuICovXG5leHBvcnQgZnVuY3Rpb24gdG9BcnJheTxUID0gdW5rbm93bj4ocGFyYW06IFQgfCBUW10pOiBBcnJheTxUPiB7XG4gIGlmICghQXJyYXkuaXNBcnJheShwYXJhbSkpIHtcbiAgICByZXR1cm4gW3BhcmFtXSBhcyBUW11cbiAgfVxuICByZXR1cm4gcGFyYW1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplT2JqZWN0S2V5KG9iamVjdE5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIC8vICsgc3ltYm9sIGNoYXJhY3RlcnMgYXJlIG5vdCBkZWNvZGVkIGFzIHNwYWNlcyBpbiBKUy4gc28gcmVwbGFjZSB0aGVtIGZpcnN0IGFuZCBkZWNvZGUgdG8gZ2V0IHRoZSBjb3JyZWN0IHJlc3VsdC5cbiAgY29uc3QgYXNTdHJOYW1lID0gKG9iamVjdE5hbWUgPyBvYmplY3ROYW1lLnRvU3RyaW5nKCkgOiAnJykucmVwbGFjZSgvXFwrL2csICcgJylcbiAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChhc1N0ck5hbWUpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVNpemUoc2l6ZT86IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBzaXplID8gTnVtYmVyLnBhcnNlSW50KHNpemUpIDogdW5kZWZpbmVkXG59XG5cbmV4cG9ydCBjb25zdCBQQVJUX0NPTlNUUkFJTlRTID0ge1xuICAvLyBhYnNNaW5QYXJ0U2l6ZSAtIGFic29sdXRlIG1pbmltdW0gcGFydCBzaXplICg1IE1pQilcbiAgQUJTX01JTl9QQVJUX1NJWkU6IDEwMjQgKiAxMDI0ICogNSxcbiAgLy8gTUlOX1BBUlRfU0laRSAtIG1pbmltdW0gcGFydCBzaXplIDE2TWlCIHBlciBvYmplY3QgYWZ0ZXIgd2hpY2hcbiAgTUlOX1BBUlRfU0laRTogMTAyNCAqIDEwMjQgKiAxNixcbiAgLy8gTUFYX1BBUlRTX0NPVU5UIC0gbWF4aW11bSBudW1iZXIgb2YgcGFydHMgZm9yIGEgc2luZ2xlIG11bHRpcGFydCBzZXNzaW9uLlxuICBNQVhfUEFSVFNfQ09VTlQ6IDEwMDAwLFxuICAvLyBNQVhfUEFSVF9TSVpFIC0gbWF4aW11bSBwYXJ0IHNpemUgNUdpQiBmb3IgYSBzaW5nbGUgbXVsdGlwYXJ0IHVwbG9hZFxuICAvLyBvcGVyYXRpb24uXG4gIE1BWF9QQVJUX1NJWkU6IDEwMjQgKiAxMDI0ICogMTAyNCAqIDUsXG4gIC8vIE1BWF9TSU5HTEVfUFVUX09CSkVDVF9TSVpFIC0gbWF4aW11bSBzaXplIDVHaUIgb2Ygb2JqZWN0IHBlciBQVVRcbiAgLy8gb3BlcmF0aW9uLlxuICBNQVhfU0lOR0xFX1BVVF9PQkpFQ1RfU0laRTogMTAyNCAqIDEwMjQgKiAxMDI0ICogNSxcbiAgLy8gTUFYX01VTFRJUEFSVF9QVVRfT0JKRUNUX1NJWkUgLSBtYXhpbXVtIHNpemUgNVRpQiBvZiBvYmplY3QgZm9yXG4gIC8vIE11bHRpcGFydCBvcGVyYXRpb24uXG4gIE1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFOiAxMDI0ICogMTAyNCAqIDEwMjQgKiAxMDI0ICogNSxcbn1cblxuY29uc3QgR0VORVJJQ19TU0VfSEVBREVSID0gJ1gtQW16LVNlcnZlci1TaWRlLUVuY3J5cHRpb24nXG5cbmNvbnN0IEVOQ1JZUFRJT05fSEVBREVSUyA9IHtcbiAgLy8gc3NlR2VuZXJpY0hlYWRlciBpcyB0aGUgQVdTIFNTRSBoZWFkZXIgdXNlZCBmb3IgU1NFLVMzIGFuZCBTU0UtS01TLlxuICBzc2VHZW5lcmljSGVhZGVyOiBHRU5FUklDX1NTRV9IRUFERVIsXG4gIC8vIHNzZUttc0tleUlEIGlzIHRoZSBBV1MgU1NFLUtNUyBrZXkgaWQuXG4gIHNzZUttc0tleUlEOiBHRU5FUklDX1NTRV9IRUFERVIgKyAnLUF3cy1LbXMtS2V5LUlkJyxcbn0gYXMgY29uc3RcblxuLyoqXG4gKiBSZXR1cm4gRW5jcnlwdGlvbiBoZWFkZXJzXG4gKiBAcGFyYW0gZW5jQ29uZmlnXG4gKiBAcmV0dXJucyBhbiBvYmplY3Qgd2l0aCBrZXkgdmFsdWUgcGFpcnMgdGhhdCBjYW4gYmUgdXNlZCBpbiBoZWFkZXJzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0RW5jcnlwdGlvbkhlYWRlcnMoZW5jQ29uZmlnOiBFbmNyeXB0aW9uKTogUmVxdWVzdEhlYWRlcnMge1xuICBjb25zdCBlbmNUeXBlID0gZW5jQ29uZmlnLnR5cGVcblxuICBpZiAoIWlzRW1wdHkoZW5jVHlwZSkpIHtcbiAgICBpZiAoZW5jVHlwZSA9PT0gRU5DUllQVElPTl9UWVBFUy5TU0VDKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBbRU5DUllQVElPTl9IRUFERVJTLnNzZUdlbmVyaWNIZWFkZXJdOiAnQUVTMjU2JyxcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGVuY1R5cGUgPT09IEVOQ1JZUFRJT05fVFlQRVMuS01TKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBbRU5DUllQVElPTl9IRUFERVJTLnNzZUdlbmVyaWNIZWFkZXJdOiBlbmNDb25maWcuU1NFQWxnb3JpdGhtLFxuICAgICAgICBbRU5DUllQVElPTl9IRUFERVJTLnNzZUttc0tleUlEXTogZW5jQ29uZmlnLktNU01hc3RlcktleUlELFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7fVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFydHNSZXF1aXJlZChzaXplOiBudW1iZXIpOiBudW1iZXIge1xuICBjb25zdCBtYXhQYXJ0U2l6ZSA9IFBBUlRfQ09OU1RSQUlOVFMuTUFYX01VTFRJUEFSVF9QVVRfT0JKRUNUX1NJWkUgLyAoUEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVFNfQ09VTlQgLSAxKVxuICBsZXQgcmVxdWlyZWRQYXJ0U2l6ZSA9IHNpemUgLyBtYXhQYXJ0U2l6ZVxuICBpZiAoc2l6ZSAlIG1heFBhcnRTaXplID4gMCkge1xuICAgIHJlcXVpcmVkUGFydFNpemUrK1xuICB9XG4gIHJlcXVpcmVkUGFydFNpemUgPSBNYXRoLnRydW5jKHJlcXVpcmVkUGFydFNpemUpXG4gIHJldHVybiByZXF1aXJlZFBhcnRTaXplXG59XG5cbi8qKlxuICogY2FsY3VsYXRlRXZlblNwbGl0cyAtIGNvbXB1dGVzIHNwbGl0cyBmb3IgYSBzb3VyY2UgYW5kIHJldHVybnNcbiAqIHN0YXJ0IGFuZCBlbmQgaW5kZXggc2xpY2VzLiBTcGxpdHMgaGFwcGVuIGV2ZW5seSB0byBiZSBzdXJlIHRoYXQgbm9cbiAqIHBhcnQgaXMgbGVzcyB0aGFuIDVNaUIsIGFzIHRoYXQgY291bGQgZmFpbCB0aGUgbXVsdGlwYXJ0IHJlcXVlc3QgaWZcbiAqIGl0IGlzIG5vdCB0aGUgbGFzdCBwYXJ0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2FsY3VsYXRlRXZlblNwbGl0czxUIGV4dGVuZHMgeyBTdGFydD86IG51bWJlciB9PihcbiAgc2l6ZTogbnVtYmVyLFxuICBvYmpJbmZvOiBULFxuKToge1xuICBzdGFydEluZGV4OiBudW1iZXJbXVxuICBvYmpJbmZvOiBUXG4gIGVuZEluZGV4OiBudW1iZXJbXVxufSB8IG51bGwge1xuICBpZiAoc2l6ZSA9PT0gMCkge1xuICAgIHJldHVybiBudWxsXG4gIH1cbiAgY29uc3QgcmVxUGFydHMgPSBwYXJ0c1JlcXVpcmVkKHNpemUpXG4gIGNvbnN0IHN0YXJ0SW5kZXhQYXJ0czogbnVtYmVyW10gPSBbXVxuICBjb25zdCBlbmRJbmRleFBhcnRzOiBudW1iZXJbXSA9IFtdXG5cbiAgbGV0IHN0YXJ0ID0gb2JqSW5mby5TdGFydFxuICBpZiAoaXNFbXB0eShzdGFydCkgfHwgc3RhcnQgPT09IC0xKSB7XG4gICAgc3RhcnQgPSAwXG4gIH1cbiAgY29uc3QgZGl2aXNvclZhbHVlID0gTWF0aC50cnVuYyhzaXplIC8gcmVxUGFydHMpXG5cbiAgY29uc3QgcmVtaW5kZXJWYWx1ZSA9IHNpemUgJSByZXFQYXJ0c1xuXG4gIGxldCBuZXh0U3RhcnQgPSBzdGFydFxuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcmVxUGFydHM7IGkrKykge1xuICAgIGxldCBjdXJQYXJ0U2l6ZSA9IGRpdmlzb3JWYWx1ZVxuICAgIGlmIChpIDwgcmVtaW5kZXJWYWx1ZSkge1xuICAgICAgY3VyUGFydFNpemUrK1xuICAgIH1cblxuICAgIGNvbnN0IGN1cnJlbnRTdGFydCA9IG5leHRTdGFydFxuICAgIGNvbnN0IGN1cnJlbnRFbmQgPSBjdXJyZW50U3RhcnQgKyBjdXJQYXJ0U2l6ZSAtIDFcbiAgICBuZXh0U3RhcnQgPSBjdXJyZW50RW5kICsgMVxuXG4gICAgc3RhcnRJbmRleFBhcnRzLnB1c2goY3VycmVudFN0YXJ0KVxuICAgIGVuZEluZGV4UGFydHMucHVzaChjdXJyZW50RW5kKVxuICB9XG5cbiAgcmV0dXJuIHsgc3RhcnRJbmRleDogc3RhcnRJbmRleFBhcnRzLCBlbmRJbmRleDogZW5kSW5kZXhQYXJ0cywgb2JqSW5mbzogb2JqSW5mbyB9XG59XG5cbmNvbnN0IGZ4cCA9IG5ldyBYTUxQYXJzZXIoKVxuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLWV4cGxpY2l0LWFueVxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlWG1sKHhtbDogc3RyaW5nKTogYW55IHtcbiAgY29uc3QgcmVzdWx0ID0gZnhwLnBhcnNlKHhtbClcbiAgaWYgKHJlc3VsdC5FcnJvcikge1xuICAgIHRocm93IHJlc3VsdC5FcnJvclxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdFxufVxuIl0sIm1hcHBpbmdzIjoiQUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsT0FBTyxLQUFLQSxNQUFNO0FBQ2xCLE9BQU8sS0FBS0MsTUFBTTtBQUVsQixTQUFTQyxTQUFTLFFBQVEsaUJBQWlCO0FBQzNDLE9BQU9DLE1BQU0sTUFBTSxXQUFXO0FBQzlCLE9BQU9DLENBQUMsTUFBTSxRQUFRO0FBQ3RCLE9BQU8sS0FBS0MsSUFBSSxNQUFNLFlBQVk7QUFHbEMsU0FBU0MsZ0JBQWdCLFFBQVEsWUFBVztBQUU1QyxNQUFNQyxvQkFBb0IsR0FBRyxhQUFhOztBQUUxQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsT0FBTyxTQUFTQyxTQUFTQSxDQUFDQyxNQUFjLEVBQUU7RUFDeEMsT0FBT0EsTUFBTSxDQUFDQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUNDLE1BQU0sQ0FBQyxDQUFDQyxHQUFXLEVBQUVDLElBQVksS0FBSztJQUM1RCxNQUFNQyxHQUFHLEdBQUdDLE1BQU0sQ0FBQ0MsSUFBSSxDQUFDSCxJQUFJLENBQUM7SUFDN0IsSUFBSUMsR0FBRyxDQUFDRyxNQUFNLEtBQUssQ0FBQyxFQUFFO01BQ3BCO01BQ0E7TUFDQSxJQUNHLEdBQUcsSUFBSUosSUFBSSxJQUFJQSxJQUFJLElBQUksR0FBRyxJQUMxQixHQUFHLElBQUlBLElBQUksSUFBSUEsSUFBSSxJQUFJLEdBQUksSUFDM0IsR0FBRyxJQUFJQSxJQUFJLElBQUlBLElBQUksSUFBSSxHQUFJLElBQzVCQSxJQUFJLEtBQUssR0FBRyxJQUNaQSxJQUFJLEtBQUssR0FBRyxJQUNaQSxJQUFJ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