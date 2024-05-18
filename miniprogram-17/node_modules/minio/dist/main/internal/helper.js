"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.calculateEvenSplits = calculateEvenSplits;
exports.extractMetadata = extractMetadata;
exports.getEncryptionHeaders = getEncryptionHeaders;
exports.getScope = getScope;
exports.getSourceVersionId = getSourceVersionId;
exports.getVersionId = getVersionId;
exports.insertContentType = insertContentType;
exports.isAmazonEndpoint = isAmazonEndpoint;
exports.isAmzHeader = isAmzHeader;
exports.isBoolean = isBoolean;
exports.isDefined = isDefined;
exports.isEmpty = isEmpty;
exports.isEmptyObject = isEmptyObject;
exports.isFunction = isFunction;
exports.isNumber = isNumber;
exports.isObject = isObject;
exports.isReadableStream = isReadableStream;
exports.isStorageClassHeader = isStorageClassHeader;
exports.isString = isString;
exports.isSupportedHeader = isSupportedHeader;
exports.isValidBucketName = isValidBucketName;
exports.isValidDate = isValidDate;
exports.isValidDomain = isValidDomain;
exports.isValidEndpoint = isValidEndpoint;
exports.isValidIP = isValidIP;
exports.isValidObjectName = isValidObjectName;
exports.isValidPort = isValidPort;
exports.isValidPrefix = isValidPrefix;
exports.isVirtualHostStyle = isVirtualHostStyle;
exports.makeDateLong = makeDateLong;
exports.makeDateShort = makeDateShort;
exports.parseXml = parseXml;
exports.partsRequired = partsRequired;
exports.pipesetup = pipesetup;
exports.prependXAMZMeta = prependXAMZMeta;
exports.probeContentType = probeContentType;
exports.readableStream = readableStream;
exports.sanitizeETag = sanitizeETag;
exports.sanitizeObjectKey = sanitizeObjectKey;
exports.sanitizeSize = sanitizeSize;
exports.toArray = toArray;
exports.toMd5 = toMd5;
exports.toSha256 = toSha256;
exports.uriEscape = uriEscape;
exports.uriResourceEscape = uriResourceEscape;
var crypto = _interopRequireWildcard(require("crypto"), true);
var stream = _interopRequireWildcard(require("stream"), true);
var _fastXmlParser = require("fast-xml-parser");
var _ipaddr = require("ipaddr.js");
var _lodash = require("lodash");
var mime = _interopRequireWildcard(require("mime-types"), true);
var _type = require("./type.js");
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

const MetaDataHeaderPrefix = 'x-amz-meta-';

/**
 * All characters in string which are NOT unreserved should be percent encoded.
 * Unreserved characters are : ALPHA / DIGIT / "-" / "." / "_" / "~"
 * Reference https://tools.ietf.org/html/rfc3986#section-2.2
 */
function uriEscape(string) {
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
function uriResourceEscape(string) {
  return uriEscape(string).replace(/%2F/g, '/');
}
function getScope(region, date, serviceName = 's3') {
  return `${makeDateShort(date)}/${region}/${serviceName}/aws4_request`;
}

/**
 * isAmazonEndpoint - true if endpoint is 's3.amazonaws.com' or 's3.cn-north-1.amazonaws.com.cn'
 */
function isAmazonEndpoint(endpoint) {
  return endpoint === 's3.amazonaws.com' || endpoint === 's3.cn-north-1.amazonaws.com.cn';
}

/**
 * isVirtualHostStyle - verify if bucket name is support with virtual
 * hosts. bucketNames with periods should be always treated as path
 * style if the protocol is 'https:', this is due to SSL wildcard
 * limitation. For all other buckets and Amazon S3 endpoint we will
 * default to virtual host style.
 */
function isVirtualHostStyle(endpoint, protocol, bucket, pathStyle) {
  if (protocol === 'https:' && bucket.includes('.')) {
    return false;
  }
  return isAmazonEndpoint(endpoint) || !pathStyle;
}
function isValidIP(ip) {
  return _ipaddr.isValid(ip);
}

/**
 * @returns if endpoint is valid domain.
 */
function isValidEndpoint(endpoint) {
  return isValidDomain(endpoint) || isValidIP(endpoint);
}

/**
 * @returns if input host is a valid domain.
 */
function isValidDomain(host) {
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
function probeContentType(path) {
  let contentType = mime.lookup(path);
  if (!contentType) {
    contentType = 'application/octet-stream';
  }
  return contentType;
}

/**
 * is input port valid.
 */
function isValidPort(port) {
  // verify if port is a number.
  if (!isNumber(port)) {
    return false;
  }

  // port `0` is valid and special case
  return 0 <= port && port <= 65535;
}
function isValidBucketName(bucket) {
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
function isValidObjectName(objectName) {
  if (!isValidPrefix(objectName)) {
    return false;
  }
  return objectName.length !== 0;
}

/**
 * check if prefix is valid
 */
function isValidPrefix(prefix) {
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
function isNumber(arg) {
  return typeof arg === 'number';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any

/**
 * check if typeof arg function
 */
function isFunction(arg) {
  return typeof arg === 'function';
}

/**
 * check if typeof arg string
 */
function isString(arg) {
  return typeof arg === 'string';
}

/**
 * check if typeof arg object
 */
function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

/**
 * check if object is readable stream
 */
function isReadableStream(arg) {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  return isObject(arg) && isFunction(arg._read);
}

/**
 * check if arg is boolean
 */
function isBoolean(arg) {
  return typeof arg === 'boolean';
}
function isEmpty(o) {
  return _lodash.isEmpty(o);
}
function isEmptyObject(o) {
  return Object.values(o).filter(x => x !== undefined).length !== 0;
}
function isDefined(o) {
  return o !== null && o !== undefined;
}

/**
 * check if arg is a valid date
 */
function isValidDate(arg) {
  // @ts-expect-error checknew Date(Math.NaN)
  return arg instanceof Date && !isNaN(arg);
}

/**
 * Create a Date string with format: 'YYYYMMDDTHHmmss' + Z
 */
function makeDateLong(date) {
  date = date || new Date();

  // Gives format like: '2017-08-07T16:28:59.889Z'
  const s = date.toISOString();
  return s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 13) + s.slice(14, 16) + s.slice(17, 19) + 'Z';
}

/**
 * Create a Date string with format: 'YYYYMMDD'
 */
function makeDateShort(date) {
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
function pipesetup(...streams) {
  // @ts-expect-error ts can't narrow this
  return streams.reduce((src, dst) => {
    src.on('error', err => dst.emit('error', err));
    return src.pipe(dst);
  });
}

/**
 * return a Readable stream that emits data
 */
function readableStream(data) {
  const s = new stream.Readable();
  s._read = () => {};
  s.push(data);
  s.push(null);
  return s;
}

/**
 * Process metadata to insert appropriate value to `content-type` attribute
 */
function insertContentType(metaData, filePath) {
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
function prependXAMZMeta(metaData) {
  if (!metaData) {
    return {};
  }
  return _lodash.mapKeys(metaData, (value, key) => {
    if (isAmzHeader(key) || isSupportedHeader(key) || isStorageClassHeader(key)) {
      return key;
    }
    return MetaDataHeaderPrefix + key;
  });
}

/**
 * Checks if it is a valid header according to the AmazonS3 API
 */
function isAmzHeader(key) {
  const temp = key.toLowerCase();
  return temp.startsWith(MetaDataHeaderPrefix) || temp === 'x-amz-acl' || temp.startsWith('x-amz-server-side-encryption-') || temp === 'x-amz-server-side-encryption';
}

/**
 * Checks if it is a supported Header
 */
function isSupportedHeader(key) {
  const supported_headers = ['content-type', 'cache-control', 'content-encoding', 'content-disposition', 'content-language', 'x-amz-website-redirect-location'];
  return supported_headers.includes(key.toLowerCase());
}

/**
 * Checks if it is a storage header
 */
function isStorageClassHeader(key) {
  return key.toLowerCase() === 'x-amz-storage-class';
}
function extractMetadata(headers) {
  return _lodash.mapKeys(_lodash.pickBy(headers, (value, key) => isSupportedHeader(key) || isStorageClassHeader(key) || isAmzHeader(key)), (value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith(MetaDataHeaderPrefix)) {
      return lower.slice(MetaDataHeaderPrefix.length);
    }
    return key;
  });
}
function getVersionId(headers = {}) {
  return headers['x-amz-version-id'] || null;
}
function getSourceVersionId(headers = {}) {
  return headers['x-amz-copy-source-version-id'] || null;
}
function sanitizeETag(etag = '') {
  const replaceChars = {
    '"': '',
    '&quot;': '',
    '&#34;': '',
    '&QUOT;': '',
    '&#x00022': ''
  };
  return etag.replace(/^("|&quot;|&#34;)|("|&quot;|&#34;)$/g, m => replaceChars[m]);
}
function toMd5(payload) {
  // use string from browser and buffer from nodejs
  // browser support is tested only against minio server
  return crypto.createHash('md5').update(Buffer.from(payload)).digest().toString('base64');
}
function toSha256(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * toArray returns a single element array with param being the element,
 * if param is just a string, and returns 'param' back if it is an array
 * So, it makes sure param is always an array
 */
function toArray(param) {
  if (!Array.isArray(param)) {
    return [param];
  }
  return param;
}
function sanitizeObjectKey(objectName) {
  // + symbol characters are not decoded as spaces in JS. so replace them first and decode to get the correct result.
  const asStrName = (objectName ? objectName.toString() : '').replace(/\+/g, ' ');
  return decodeURIComponent(asStrName);
}
function sanitizeSize(size) {
  return size ? Number.parseInt(size) : undefined;
}
const PART_CONSTRAINTS = {
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
exports.PART_CONSTRAINTS = PART_CONSTRAINTS;
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
function getEncryptionHeaders(encConfig) {
  const encType = encConfig.type;
  if (!isEmpty(encType)) {
    if (encType === _type.ENCRYPTION_TYPES.SSEC) {
      return {
        [ENCRYPTION_HEADERS.sseGenericHeader]: 'AES256'
      };
    } else if (encType === _type.ENCRYPTION_TYPES.KMS) {
      return {
        [ENCRYPTION_HEADERS.sseGenericHeader]: encConfig.SSEAlgorithm,
        [ENCRYPTION_HEADERS.sseKmsKeyID]: encConfig.KMSMasterKeyID
      };
    }
  }
  return {};
}
function partsRequired(size) {
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
function calculateEvenSplits(size, objInfo) {
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
const fxp = new _fastXmlParser.XMLParser();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseXml(xml) {
  const result = fxp.parse(xml);
  if (result.Error) {
    throw result.Error;
  }
  return result;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsInJlcXVpcmUiLCJzdHJlYW0iLCJfZmFzdFhtbFBhcnNlciIsIl9pcGFkZHIiLCJfbG9kYXNoIiwibWltZSIsIl90eXBlIiwiX2dldFJlcXVpcmVXaWxkY2FyZENhY2hlIiwibm9kZUludGVyb3AiLCJXZWFrTWFwIiwiY2FjaGVCYWJlbEludGVyb3AiLCJjYWNoZU5vZGVJbnRlcm9wIiwib2JqIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJjYWNoZSIsImhhcyIsImdldCIsIm5ld09iaiIsImhhc1Byb3BlcnR5RGVzY3JpcHRvciIsIk9iamVjdCIsImRlZmluZVByb3BlcnR5IiwiZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yIiwia2V5IiwicHJvdG90eXBlIiwiaGFzT3duUHJvcGVydHkiLCJjYWxsIiwiZGVzYyIsInNldCIsIk1ldGFEYXRhSGVhZGVyUHJlZml4IiwidXJpRXNjYXBlIiwic3RyaW5nIiwic3BsaXQiLCJyZWR1Y2UiLCJhY2MiLCJlbGVtIiwiYnVmIiwiQnVmZmVyIiwiZnJvbSIsImxlbmd0aCIsImNoYXIiLCJ0b1N0cmluZyIsInRvVXBwZXJDYXNlIiwidXJpUmVzb3VyY2VFc2NhcGUiLCJyZXBsYWNlIiwiZ2V0U2NvcGUiLCJyZWdpb24iLCJkYXRlIiwic2VydmljZU5hbWUiLCJtYWtlRGF0ZVNob3J0IiwiaXNBbWF6b25FbmRwb2ludCIsImVuZHBvaW50IiwiaXNWaXJ0dWFsSG9zdFN0eWxlIiwicHJvdG9jb2wiLCJidWNrZXQiLCJwYXRoU3R5bGUiLCJpbmNsdWRlcyIsImlzVmFsaWRJUCIsImlwIiwiaXBhZGRyIiwiaXNWYWxpZCIsImlzVmFsaWRFbmRwb2ludCIsImlzVmFsaWREb21haW4iLCJob3N0IiwiaXNTdHJpbmciLCJzbGljZSIsImFscGhhTnVtZXJpY3MiLCJwcm9iZUNvbnRlbnRUeXBlIiwicGF0aCIsImNvbnRlbnRUeXBlIiwibG9va3VwIiwiaXNWYWxpZFBvcnQiLCJwb3J0IiwiaXNOdW1iZXIiLCJpc1ZhbGlkQnVja2V0TmFtZSIsInRlc3QiLCJpc1ZhbGlkT2JqZWN0TmFtZSIsIm9iamVjdE5hbWUiLCJpc1ZhbGlkUHJlZml4IiwicHJlZml4IiwiYXJnIiwiaXNGdW5jdGlvbiIsImlzT2JqZWN0IiwiaXNSZWFkYWJsZVN0cmVhbSIsIl9yZWFkIiwiaXNCb29sZWFuIiwiaXNFbXB0eSIsIm8iLCJfIiwiaXNFbXB0eU9iamVjdCIsInZhbHVlcyIsImZpbHRlciIsIngiLCJ1bmRlZmluZWQiLCJpc0RlZmluZWQiLCJpc1ZhbGlkRGF0ZSIsIkRhdGUiLCJpc05hTiIsIm1ha2VEYXRlTG9uZyIsInMiLCJ0b0lTT1N0cmluZyIsInBpcGVzZXR1cCIsInN0cmVhbXMiLCJzcmMiLCJkc3QiLCJvbiIsImVyciIsImVtaXQiLCJwaXBlIiwicmVhZGFibGVTdHJlYW0iLCJkYXRhIiwiUmVhZGFibGUiLCJwdXNoIiwiaW5zZXJ0Q29udGVudFR5cGUiLCJtZXRhRGF0YSIsImZpbGVQYXRoIiwidG9Mb3dlckNhc2UiLCJwcmVwZW5kWEFNWk1ldGEiLCJtYXBLZXlzIiwidmFsdWUiLCJpc0FtekhlYWRlciIsImlzU3VwcG9ydGVkSGVhZGVyIiwiaXNTdG9yYWdlQ2xhc3NIZWFkZXIiLCJ0ZW1wIiwic3RhcnRzV2l0aCIsInN1cHBvcnRlZF9oZWFkZXJzIiwiZXh0cmFjdE1ldGFkYXRhIiwiaGVhZGVycyIsInBpY2tCeSIsImxvd2VyIiwiZ2V0VmVyc2lvbklkIiwiZ2V0U291cmNlVmVyc2lvbklkIiwic2FuaXRpemVFVGFnIiwiZXRhZyIsInJlcGxhY2VDaGFycyIsIm0iLCJ0b01kNSIsInBheWxvYWQiLCJjcmVhdGVIYXNoIiwidXBkYXRlIiwiZGlnZXN0IiwidG9TaGEyNTYiLCJ0b0FycmF5IiwicGFyYW0iLCJBcnJheSIsImlzQXJyYXkiLCJzYW5pdGl6ZU9iamVjdEtleSIsImFzU3RyTmFtZSIsImRlY29kZVVSSUNvbXBvbmVudCIsInNhbml0aXplU2l6ZSIsInNpemUiLCJOdW1iZXIiLCJwYXJzZUludCIsIlBBUlRfQ09OU1RSQUlOVFMiLCJBQlNfTUlOX1BBUlRfU0laRSIsIk1JTl9QQVJUX1NJWkUiLCJNQVhfUEFSVFNfQ09VTlQiLCJNQVhfUEFSVF9TSVpFIiwiTUFYX1NJTkdMRV9QVVRfT0JKRUNUX1NJWkUiLCJNQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSIsImV4cG9ydHMiLCJHRU5FUklDX1NTRV9IRUFERVIiLCJFTkNSWVBUSU9OX0hFQURFUlMiLCJzc2VHZW5lcmljSGVhZGVyIiwic3NlS21zS2V5SUQiLCJnZXRFbmNyeXB0aW9uSGVhZGVycyIsImVuY0NvbmZpZyIsImVuY1R5cGUiLCJ0eXBlIiwiRU5DUllQVElPTl9UWVBFUyIsIlNTRUMiLCJLTVMiLCJTU0VBbGdvcml0aG0iLCJLTVNNYXN0ZXJLZXlJRCIsInBhcnRzUmVxdWlyZWQiLCJtYXhQYXJ0U2l6ZSIsInJlcXVpcmVkUGFydFNpemUiLCJNYXRoIiwidHJ1bmMiLCJjYWxjdWxhdGVFdmVuU3BsaXRzIiwib2JqSW5mbyIsInJlcVBhcnRzIiwic3RhcnRJbmRleFBhcnRzIiwiZW5kSW5kZXhQYXJ0cyIsInN0YXJ0IiwiU3RhcnQiLCJkaXZpc29yVmFsdWUiLCJyZW1pbmRlclZhbHVlIiwibmV4dFN0YXJ0IiwiaSIsImN1clBhcnRTaXplIiwiY3VycmVudFN0YXJ0IiwiY3VycmVudEVuZCIsInN0YXJ0SW5kZXgiLCJlbmRJbmRleCIsImZ4cCIsIlhNTFBhcnNlciIsInBhcnNlWG1sIiwieG1sIiwicmVzdWx0IiwicGFyc2UiLCJFcnJvciJdLCJzb3VyY2VzIjpbImhlbHBlci50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuICogTWluSU8gSmF2YXNjcmlwdCBMaWJyYXJ5IGZvciBBbWF6b24gUzMgQ29tcGF0aWJsZSBDbG91ZCBTdG9yYWdlLCAoQykgMjAxNSBNaW5JTywgSW5jLlxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiAgICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqL1xuXG5pbXBvcnQgKiBhcyBjcnlwdG8gZnJvbSAnbm9kZTpjcnlwdG8nXG5pbXBvcnQgKiBhcyBzdHJlYW0gZnJvbSAnbm9kZTpzdHJlYW0nXG5cbmltcG9ydCB7IFhNTFBhcnNlciB9IGZyb20gJ2Zhc3QteG1sLXBhcnNlcidcbmltcG9ydCBpcGFkZHIgZnJvbSAnaXBhZGRyLmpzJ1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJ1xuaW1wb3J0ICogYXMgbWltZSBmcm9tICdtaW1lLXR5cGVzJ1xuXG5pbXBvcnQgdHlwZSB7IEJpbmFyeSwgRW5jcnlwdGlvbiwgT2JqZWN0TWV0YURhdGEsIFJlcXVlc3RIZWFkZXJzLCBSZXNwb25zZUhlYWRlciB9IGZyb20gJy4vdHlwZS50cydcbmltcG9ydCB7IEVOQ1JZUFRJT05fVFlQRVMgfSBmcm9tICcuL3R5cGUudHMnXG5cbmNvbnN0IE1ldGFEYXRhSGVhZGVyUHJlZml4ID0gJ3gtYW16LW1ldGEtJ1xuXG4vKipcbiAqIEFsbCBjaGFyYWN0ZXJzIGluIHN0cmluZyB3aGljaCBhcmUgTk9UIHVucmVzZXJ2ZWQgc2hvdWxkIGJlIHBlcmNlbnQgZW5jb2RlZC5cbiAqIFVucmVzZXJ2ZWQgY2hhcmFjdGVycyBhcmUgOiBBTFBIQSAvIERJR0lUIC8gXCItXCIgLyBcIi5cIiAvIFwiX1wiIC8gXCJ+XCJcbiAqIFJlZmVyZW5jZSBodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMzk4NiNzZWN0aW9uLTIuMlxuICovXG5leHBvcnQgZnVuY3Rpb24gdXJpRXNjYXBlKHN0cmluZzogc3RyaW5nKSB7XG4gIHJldHVybiBzdHJpbmcuc3BsaXQoJycpLnJlZHVjZSgoYWNjOiBzdHJpbmcsIGVsZW06IHN0cmluZykgPT4ge1xuICAgIGNvbnN0IGJ1ZiA9IEJ1ZmZlci5mcm9tKGVsZW0pXG4gICAgaWYgKGJ1Zi5sZW5ndGggPT09IDEpIHtcbiAgICAgIC8vIGxlbmd0aCAxIGluZGljYXRlcyB0aGF0IGVsZW0gaXMgbm90IGEgdW5pY29kZSBjaGFyYWN0ZXIuXG4gICAgICAvLyBDaGVjayBpZiBpdCBpcyBhbiB1bnJlc2VydmVkIGNoYXJhY2VyLlxuICAgICAgaWYgKFxuICAgICAgICAoJ0EnIDw9IGVsZW0gJiYgZWxlbSA8PSAnWicpIHx8XG4gICAgICAgICgnYScgPD0gZWxlbSAmJiBlbGVtIDw9ICd6JykgfHxcbiAgICAgICAgKCcwJyA8PSBlbGVtICYmIGVsZW0gPD0gJzknKSB8fFxuICAgICAgICBlbGVtID09PSAnXycgfHxcbiAgICAgICAgZWxlbSA9PT0gJy4nIHx8XG4gICAgICAgIGVsZW0gPT09ICd+JyB8fFxuICAgICAgICBlbGVtID09PSAnLSdcbiAgICAgICkge1xuICAgICAgICAvLyBVbnJlc2VydmVkIGNoYXJhY2VyIHNob3VsZCBub3QgYmUgZW5jb2RlZC5cbiAgICAgICAgYWNjID0gYWNjICsgZWxlbVxuICAgICAgICByZXR1cm4gYWNjXG4gICAgICB9XG4gICAgfVxuICAgIC8vIGVsZW0gbmVlZHMgZW5jb2RpbmcgLSBpLmUgZWxlbSBzaG91bGQgYmUgZW5jb2RlZCBpZiBpdCdzIG5vdCB1bnJlc2VydmVkXG4gICAgLy8gY2hhcmFjdGVyIG9yIGlmIGl0J3MgYSB1bmljb2RlIGNoYXJhY3Rlci5cbiAgICBmb3IgKGNvbnN0IGNoYXIgb2YgYnVmKSB7XG4gICAgICBhY2MgPSBhY2MgKyAnJScgKyBjaGFyLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpXG4gICAgfVxuICAgIHJldHVybiBhY2NcbiAgfSwgJycpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB1cmlSZXNvdXJjZUVzY2FwZShzdHJpbmc6IHN0cmluZykge1xuICByZXR1cm4gdXJpRXNjYXBlKHN0cmluZykucmVwbGFjZSgvJTJGL2csICcvJylcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFNjb3BlKHJlZ2lvbjogc3RyaW5nLCBkYXRlOiBEYXRlLCBzZXJ2aWNlTmFtZSA9ICdzMycpIHtcbiAgcmV0dXJuIGAke21ha2VEYXRlU2hvcnQoZGF0ZSl9LyR7cmVnaW9ufS8ke3NlcnZpY2VOYW1lfS9hd3M0X3JlcXVlc3RgXG59XG5cbi8qKlxuICogaXNBbWF6b25FbmRwb2ludCAtIHRydWUgaWYgZW5kcG9pbnQgaXMgJ3MzLmFtYXpvbmF3cy5jb20nIG9yICdzMy5jbi1ub3J0aC0xLmFtYXpvbmF3cy5jb20uY24nXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0FtYXpvbkVuZHBvaW50KGVuZHBvaW50OiBzdHJpbmcpIHtcbiAgcmV0dXJuIGVuZHBvaW50ID09PSAnczMuYW1hem9uYXdzLmNvbScgfHwgZW5kcG9pbnQgPT09ICdzMy5jbi1ub3J0aC0xLmFtYXpvbmF3cy5jb20uY24nXG59XG5cbi8qKlxuICogaXNWaXJ0dWFsSG9zdFN0eWxlIC0gdmVyaWZ5IGlmIGJ1Y2tldCBuYW1lIGlzIHN1cHBvcnQgd2l0aCB2aXJ0dWFsXG4gKiBob3N0cy4gYnVja2V0TmFtZXMgd2l0aCBwZXJpb2RzIHNob3VsZCBiZSBhbHdheXMgdHJlYXRlZCBhcyBwYXRoXG4gKiBzdHlsZSBpZiB0aGUgcHJvdG9jb2wgaXMgJ2h0dHBzOicsIHRoaXMgaXMgZHVlIHRvIFNTTCB3aWxkY2FyZFxuICogbGltaXRhdGlvbi4gRm9yIGFsbCBvdGhlciBidWNrZXRzIGFuZCBBbWF6b24gUzMgZW5kcG9pbnQgd2Ugd2lsbFxuICogZGVmYXVsdCB0byB2aXJ0dWFsIGhvc3Qgc3R5bGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZpcnR1YWxIb3N0U3R5bGUoZW5kcG9pbnQ6IHN0cmluZywgcHJvdG9jb2w6IHN0cmluZywgYnVja2V0OiBzdHJpbmcsIHBhdGhTdHlsZTogYm9vbGVhbikge1xuICBpZiAocHJvdG9jb2wgPT09ICdodHRwczonICYmIGJ1Y2tldC5pbmNsdWRlcygnLicpKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgcmV0dXJuIGlzQW1hem9uRW5kcG9pbnQoZW5kcG9pbnQpIHx8ICFwYXRoU3R5bGVcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRJUChpcDogc3RyaW5nKSB7XG4gIHJldHVybiBpcGFkZHIuaXNWYWxpZChpcClcbn1cblxuLyoqXG4gKiBAcmV0dXJucyBpZiBlbmRwb2ludCBpcyB2YWxpZCBkb21haW4uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkRW5kcG9pbnQoZW5kcG9pbnQ6IHN0cmluZykge1xuICByZXR1cm4gaXNWYWxpZERvbWFpbihlbmRwb2ludCkgfHwgaXNWYWxpZElQKGVuZHBvaW50KVxufVxuXG4vKipcbiAqIEByZXR1cm5zIGlmIGlucHV0IGhvc3QgaXMgYSB2YWxpZCBkb21haW4uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkRG9tYWluKGhvc3Q6IHN0cmluZykge1xuICBpZiAoIWlzU3RyaW5nKGhvc3QpKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgLy8gU2VlIFJGQyAxMDM1LCBSRkMgMzY5Ni5cbiAgaWYgKGhvc3QubGVuZ3RoID09PSAwIHx8IGhvc3QubGVuZ3RoID4gMjU1KSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgLy8gSG9zdCBjYW5ub3Qgc3RhcnQgb3IgZW5kIHdpdGggYSAnLSdcbiAgaWYgKGhvc3RbMF0gPT09ICctJyB8fCBob3N0LnNsaWNlKC0xKSA9PT0gJy0nKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgLy8gSG9zdCBjYW5ub3Qgc3RhcnQgb3IgZW5kIHdpdGggYSAnXydcbiAgaWYgKGhvc3RbMF0gPT09ICdfJyB8fCBob3N0LnNsaWNlKC0xKSA9PT0gJ18nKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgLy8gSG9zdCBjYW5ub3Qgc3RhcnQgd2l0aCBhICcuJ1xuICBpZiAoaG9zdFswXSA9PT0gJy4nKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICBjb25zdCBhbHBoYU51bWVyaWNzID0gJ2B+IUAjJCVeJiooKSs9e31bXXxcXFxcXCJcXCc7Oj48Py8nXG4gIC8vIEFsbCBub24gYWxwaGFudW1lcmljIGNoYXJhY3RlcnMgYXJlIGludmFsaWQuXG4gIGZvciAoY29uc3QgY2hhciBvZiBhbHBoYU51bWVyaWNzKSB7XG4gICAgaWYgKGhvc3QuaW5jbHVkZXMoY2hhcikpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxuICAvLyBObyBuZWVkIHRvIHJlZ2V4cCBtYXRjaCwgc2luY2UgdGhlIGxpc3QgaXMgbm9uLWV4aGF1c3RpdmUuXG4gIC8vIFdlIGxldCBpdCBiZSB2YWxpZCBhbmQgZmFpbCBsYXRlci5cbiAgcmV0dXJuIHRydWVcbn1cblxuLyoqXG4gKiBQcm9iZXMgY29udGVudFR5cGUgdXNpbmcgZmlsZSBleHRlbnNpb25zLlxuICpcbiAqIEBleGFtcGxlXG4gKiBgYGBcbiAqIC8vIHJldHVybiAnaW1hZ2UvcG5nJ1xuICogcHJvYmVDb250ZW50VHlwZSgnZmlsZS5wbmcnKVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcm9iZUNvbnRlbnRUeXBlKHBhdGg6IHN0cmluZykge1xuICBsZXQgY29udGVudFR5cGUgPSBtaW1lLmxvb2t1cChwYXRoKVxuICBpZiAoIWNvbnRlbnRUeXBlKSB7XG4gICAgY29udGVudFR5cGUgPSAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJ1xuICB9XG4gIHJldHVybiBjb250ZW50VHlwZVxufVxuXG4vKipcbiAqIGlzIGlucHV0IHBvcnQgdmFsaWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkUG9ydChwb3J0OiB1bmtub3duKTogcG9ydCBpcyBudW1iZXIge1xuICAvLyB2ZXJpZnkgaWYgcG9ydCBpcyBhIG51bWJlci5cbiAgaWYgKCFpc051bWJlcihwb3J0KSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLy8gcG9ydCBgMGAgaXMgdmFsaWQgYW5kIHNwZWNpYWwgY2FzZVxuICByZXR1cm4gMCA8PSBwb3J0ICYmIHBvcnQgPD0gNjU1MzVcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldDogdW5rbm93bikge1xuICBpZiAoIWlzU3RyaW5nKGJ1Y2tldCkpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIGJ1Y2tldCBsZW5ndGggc2hvdWxkIGJlIGxlc3MgdGhhbiBhbmQgbm8gbW9yZSB0aGFuIDYzXG4gIC8vIGNoYXJhY3RlcnMgbG9uZy5cbiAgaWYgKGJ1Y2tldC5sZW5ndGggPCAzIHx8IGJ1Y2tldC5sZW5ndGggPiA2Mykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIGJ1Y2tldCB3aXRoIHN1Y2Nlc3NpdmUgcGVyaW9kcyBpcyBpbnZhbGlkLlxuICBpZiAoYnVja2V0LmluY2x1ZGVzKCcuLicpKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgLy8gYnVja2V0IGNhbm5vdCBoYXZlIGlwIGFkZHJlc3Mgc3R5bGUuXG4gIGlmICgvWzAtOV0rXFwuWzAtOV0rXFwuWzAtOV0rXFwuWzAtOV0rLy50ZXN0KGJ1Y2tldCkpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuICAvLyBidWNrZXQgc2hvdWxkIGJlZ2luIHdpdGggYWxwaGFiZXQvbnVtYmVyIGFuZCBlbmQgd2l0aCBhbHBoYWJldC9udW1iZXIsXG4gIC8vIHdpdGggYWxwaGFiZXQvbnVtYmVyLy4tIGluIHRoZSBtaWRkbGUuXG4gIGlmICgvXlthLXowLTldW2EtejAtOS4tXStbYS16MC05XSQvLnRlc3QoYnVja2V0KSkge1xuICAgIHJldHVybiB0cnVlXG4gIH1cbiAgcmV0dXJuIGZhbHNlXG59XG5cbi8qKlxuICogY2hlY2sgaWYgb2JqZWN0TmFtZSBpcyBhIHZhbGlkIG9iamVjdCBuYW1lXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lOiB1bmtub3duKSB7XG4gIGlmICghaXNWYWxpZFByZWZpeChvYmplY3ROYW1lKSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgcmV0dXJuIG9iamVjdE5hbWUubGVuZ3RoICE9PSAwXG59XG5cbi8qKlxuICogY2hlY2sgaWYgcHJlZml4IGlzIHZhbGlkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkUHJlZml4KHByZWZpeDogdW5rbm93bik6IHByZWZpeCBpcyBzdHJpbmcge1xuICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuICBpZiAocHJlZml4Lmxlbmd0aCA+IDEwMjQpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuICByZXR1cm4gdHJ1ZVxufVxuXG4vKipcbiAqIGNoZWNrIGlmIHR5cGVvZiBhcmcgbnVtYmVyXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc051bWJlcihhcmc6IHVua25vd24pOiBhcmcgaXMgbnVtYmVyIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdudW1iZXInXG59XG5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZXhwbGljaXQtYW55XG5leHBvcnQgdHlwZSBBbnlGdW5jdGlvbiA9ICguLi5hcmdzOiBhbnlbXSkgPT4gYW55XG5cbi8qKlxuICogY2hlY2sgaWYgdHlwZW9mIGFyZyBmdW5jdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNGdW5jdGlvbihhcmc6IHVua25vd24pOiBhcmcgaXMgQW55RnVuY3Rpb24ge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ2Z1bmN0aW9uJ1xufVxuXG4vKipcbiAqIGNoZWNrIGlmIHR5cGVvZiBhcmcgc3RyaW5nXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1N0cmluZyhhcmc6IHVua25vd24pOiBhcmcgaXMgc3RyaW5nIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdzdHJpbmcnXG59XG5cbi8qKlxuICogY2hlY2sgaWYgdHlwZW9mIGFyZyBvYmplY3RcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzT2JqZWN0KGFyZzogdW5rbm93bik6IGFyZyBpcyBvYmplY3Qge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgYXJnICE9PSBudWxsXG59XG5cbi8qKlxuICogY2hlY2sgaWYgb2JqZWN0IGlzIHJlYWRhYmxlIHN0cmVhbVxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNSZWFkYWJsZVN0cmVhbShhcmc6IHVua25vd24pOiBhcmcgaXMgc3RyZWFtLlJlYWRhYmxlIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC91bmJvdW5kLW1ldGhvZFxuICByZXR1cm4gaXNPYmplY3QoYXJnKSAmJiBpc0Z1bmN0aW9uKChhcmcgYXMgc3RyZWFtLlJlYWRhYmxlKS5fcmVhZClcbn1cblxuLyoqXG4gKiBjaGVjayBpZiBhcmcgaXMgYm9vbGVhblxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNCb29sZWFuKGFyZzogdW5rbm93bik6IGFyZyBpcyBib29sZWFuIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdib29sZWFuJ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNFbXB0eShvOiB1bmtub3duKTogbyBpcyBudWxsIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIF8uaXNFbXB0eShvKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNFbXB0eU9iamVjdChvOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IGJvb2xlYW4ge1xuICByZXR1cm4gT2JqZWN0LnZhbHVlcyhvKS5maWx0ZXIoKHgpID0+IHggIT09IHVuZGVmaW5lZCkubGVuZ3RoICE9PSAwXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0RlZmluZWQ8VD4obzogVCk6IG8gaXMgRXhjbHVkZTxULCBudWxsIHwgdW5kZWZpbmVkPiB7XG4gIHJldHVybiBvICE9PSBudWxsICYmIG8gIT09IHVuZGVmaW5lZFxufVxuXG4vKipcbiAqIGNoZWNrIGlmIGFyZyBpcyBhIHZhbGlkIGRhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWREYXRlKGFyZzogdW5rbm93bik6IGFyZyBpcyBEYXRlIHtcbiAgLy8gQHRzLWV4cGVjdC1lcnJvciBjaGVja25ldyBEYXRlKE1hdGguTmFOKVxuICByZXR1cm4gYXJnIGluc3RhbmNlb2YgRGF0ZSAmJiAhaXNOYU4oYXJnKVxufVxuXG4vKipcbiAqIENyZWF0ZSBhIERhdGUgc3RyaW5nIHdpdGggZm9ybWF0OiAnWVlZWU1NRERUSEhtbXNzJyArIFpcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1ha2VEYXRlTG9uZyhkYXRlPzogRGF0ZSk6IHN0cmluZyB7XG4gIGRhdGUgPSBkYXRlIHx8IG5ldyBEYXRlKClcblxuICAvLyBHaXZlcyBmb3JtYXQgbGlrZTogJzIwMTctMDgtMDdUMTY6Mjg6NTkuODg5WidcbiAgY29uc3QgcyA9IGRhdGUudG9JU09TdHJpbmcoKVxuXG4gIHJldHVybiBzLnNsaWNlKDAsIDQpICsgcy5zbGljZSg1LCA3KSArIHMuc2xpY2UoOCwgMTMpICsgcy5zbGljZSgxNCwgMTYpICsgcy5zbGljZSgxNywgMTkpICsgJ1onXG59XG5cbi8qKlxuICogQ3JlYXRlIGEgRGF0ZSBzdHJpbmcgd2l0aCBmb3JtYXQ6ICdZWVlZTU1ERCdcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1ha2VEYXRlU2hvcnQoZGF0ZT86IERhdGUpIHtcbiAgZGF0ZSA9IGRhdGUgfHwgbmV3IERhdGUoKVxuXG4gIC8vIEdpdmVzIGZvcm1hdCBsaWtlOiAnMjAxNy0wOC0wN1QxNjoyODo1OS44ODlaJ1xuICBjb25zdCBzID0gZGF0ZS50b0lTT1N0cmluZygpXG5cbiAgcmV0dXJuIHMuc2xpY2UoMCwgNCkgKyBzLnNsaWNlKDUsIDcpICsgcy5zbGljZSg4LCAxMClcbn1cblxuLyoqXG4gKiBwaXBlc2V0dXAgc2V0cyB1cCBwaXBlKCkgZnJvbSBsZWZ0IHRvIHJpZ2h0IG9zIHN0cmVhbXMgYXJyYXlcbiAqIHBpcGVzZXR1cCB3aWxsIGFsc28gbWFrZSBzdXJlIHRoYXQgZXJyb3IgZW1pdHRlZCBhdCBhbnkgb2YgdGhlIHVwc3RyZWFtIFN0cmVhbVxuICogd2lsbCBiZSBlbWl0dGVkIGF0IHRoZSBsYXN0IHN0cmVhbS4gVGhpcyBtYWtlcyBlcnJvciBoYW5kbGluZyBzaW1wbGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBpcGVzZXR1cCguLi5zdHJlYW1zOiBbc3RyZWFtLlJlYWRhYmxlLCAuLi5zdHJlYW0uRHVwbGV4W10sIHN0cmVhbS5Xcml0YWJsZV0pIHtcbiAgLy8gQHRzLWV4cGVjdC1lcnJvciB0cyBjYW4ndCBuYXJyb3cgdGhpc1xuICByZXR1cm4gc3RyZWFtcy5yZWR1Y2UoKHNyYzogc3RyZWFtLlJlYWRhYmxlLCBkc3Q6IHN0cmVhbS5Xcml0YWJsZSkgPT4ge1xuICAgIHNyYy5vbignZXJyb3InLCAoZXJyKSA9PiBkc3QuZW1pdCgnZXJyb3InLCBlcnIpKVxuICAgIHJldHVybiBzcmMucGlwZShkc3QpXG4gIH0pXG59XG5cbi8qKlxuICogcmV0dXJuIGEgUmVhZGFibGUgc3RyZWFtIHRoYXQgZW1pdHMgZGF0YVxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVhZGFibGVTdHJlYW0oZGF0YTogdW5rbm93bik6IHN0cmVhbS5SZWFkYWJsZSB7XG4gIGNvbnN0IHMgPSBuZXcgc3RyZWFtLlJlYWRhYmxlKClcbiAgcy5fcmVhZCA9ICgpID0+IHt9XG4gIHMucHVzaChkYXRhKVxuICBzLnB1c2gobnVsbClcbiAgcmV0dXJuIHNcbn1cblxuLyoqXG4gKiBQcm9jZXNzIG1ldGFkYXRhIHRvIGluc2VydCBhcHByb3ByaWF0ZSB2YWx1ZSB0byBgY29udGVudC10eXBlYCBhdHRyaWJ1dGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGluc2VydENvbnRlbnRUeXBlKG1ldGFEYXRhOiBPYmplY3RNZXRhRGF0YSwgZmlsZVBhdGg6IHN0cmluZyk6IE9iamVjdE1ldGFEYXRhIHtcbiAgLy8gY2hlY2sgaWYgY29udGVudC10eXBlIGF0dHJpYnV0ZSBwcmVzZW50IGluIG1ldGFEYXRhXG4gIGZvciAoY29uc3Qga2V5IGluIG1ldGFEYXRhKSB7XG4gICAgaWYgKGtleS50b0xvd2VyQ2FzZSgpID09PSAnY29udGVudC10eXBlJykge1xuICAgICAgcmV0dXJuIG1ldGFEYXRhXG4gICAgfVxuICB9XG5cbiAgLy8gaWYgYGNvbnRlbnQtdHlwZWAgYXR0cmlidXRlIGlzIG5vdCBwcmVzZW50IGluIG1ldGFkYXRhLCB0aGVuIGluZmVyIGl0IGZyb20gdGhlIGV4dGVuc2lvbiBpbiBmaWxlUGF0aFxuICByZXR1cm4ge1xuICAgIC4uLm1ldGFEYXRhLFxuICAgICdjb250ZW50LXR5cGUnOiBwcm9iZUNvbnRlbnRUeXBlKGZpbGVQYXRoKSxcbiAgfVxufVxuXG4vKipcbiAqIEZ1bmN0aW9uIHByZXBlbmRzIG1ldGFkYXRhIHdpdGggdGhlIGFwcHJvcHJpYXRlIHByZWZpeCBpZiBpdCBpcyBub3QgYWxyZWFkeSBvblxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJlcGVuZFhBTVpNZXRhKG1ldGFEYXRhPzogT2JqZWN0TWV0YURhdGEpOiBSZXF1ZXN0SGVhZGVycyB7XG4gIGlmICghbWV0YURhdGEpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIHJldHVybiBfLm1hcEtleXMobWV0YURhdGEsICh2YWx1ZSwga2V5KSA9PiB7XG4gICAgaWYgKGlzQW16SGVhZGVyKGtleSkgfHwgaXNTdXBwb3J0ZWRIZWFkZXIoa2V5KSB8fCBpc1N0b3JhZ2VDbGFzc0hlYWRlcihrZXkpKSB7XG4gICAgICByZXR1cm4ga2V5XG4gICAgfVxuXG4gICAgcmV0dXJuIE1ldGFEYXRhSGVhZGVyUHJlZml4ICsga2V5XG4gIH0pXG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGl0IGlzIGEgdmFsaWQgaGVhZGVyIGFjY29yZGluZyB0byB0aGUgQW1hem9uUzMgQVBJXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0FtekhlYWRlcihrZXk6IHN0cmluZykge1xuICBjb25zdCB0ZW1wID0ga2V5LnRvTG93ZXJDYXNlKClcbiAgcmV0dXJuIChcbiAgICB0ZW1wLnN0YXJ0c1dpdGgoTWV0YURhdGFIZWFkZXJQcmVmaXgpIHx8XG4gICAgdGVtcCA9PT0gJ3gtYW16LWFjbCcgfHxcbiAgICB0ZW1wLnN0YXJ0c1dpdGgoJ3gtYW16LXNlcnZlci1zaWRlLWVuY3J5cHRpb24tJykgfHxcbiAgICB0ZW1wID09PSAneC1hbXotc2VydmVyLXNpZGUtZW5jcnlwdGlvbidcbiAgKVxufVxuXG4vKipcbiAqIENoZWNrcyBpZiBpdCBpcyBhIHN1cHBvcnRlZCBIZWFkZXJcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3VwcG9ydGVkSGVhZGVyKGtleTogc3RyaW5nKSB7XG4gIGNvbnN0IHN1cHBvcnRlZF9oZWFkZXJzID0gW1xuICAgICdjb250ZW50LXR5cGUnLFxuICAgICdjYWNoZS1jb250cm9sJyxcbiAgICAnY29udGVudC1lbmNvZGluZycsXG4gICAgJ2NvbnRlbnQtZGlzcG9zaXRpb24nLFxuICAgICdjb250ZW50LWxhbmd1YWdlJyxcbiAgICAneC1hbXotd2Vic2l0ZS1yZWRpcmVjdC1sb2NhdGlvbicsXG4gIF1cbiAgcmV0dXJuIHN1cHBvcnRlZF9oZWFkZXJzLmluY2x1ZGVzKGtleS50b0xvd2VyQ2FzZSgpKVxufVxuXG4vKipcbiAqIENoZWNrcyBpZiBpdCBpcyBhIHN0b3JhZ2UgaGVhZGVyXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1N0b3JhZ2VDbGFzc0hlYWRlcihrZXk6IHN0cmluZykge1xuICByZXR1cm4ga2V5LnRvTG93ZXJDYXNlKCkgPT09ICd4LWFtei1zdG9yYWdlLWNsYXNzJ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdE1ldGFkYXRhKGhlYWRlcnM6IFJlc3BvbnNlSGVhZGVyKSB7XG4gIHJldHVybiBfLm1hcEtleXMoXG4gICAgXy5waWNrQnkoaGVhZGVycywgKHZhbHVlLCBrZXkpID0+IGlzU3VwcG9ydGVkSGVhZGVyKGtleSkgfHwgaXNTdG9yYWdlQ2xhc3NIZWFkZXIoa2V5KSB8fCBpc0FtekhlYWRlcihrZXkpKSxcbiAgICAodmFsdWUsIGtleSkgPT4ge1xuICAgICAgY29uc3QgbG93ZXIgPSBrZXkudG9Mb3dlckNhc2UoKVxuICAgICAgaWYgKGxvd2VyLnN0YXJ0c1dpdGgoTWV0YURhdGFIZWFkZXJQcmVmaXgpKSB7XG4gICAgICAgIHJldHVybiBsb3dlci5zbGljZShNZXRhRGF0YUhlYWRlclByZWZpeC5sZW5ndGgpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBrZXlcbiAgICB9LFxuICApXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRWZXJzaW9uSWQoaGVhZGVyczogUmVzcG9uc2VIZWFkZXIgPSB7fSkge1xuICByZXR1cm4gaGVhZGVyc1sneC1hbXotdmVyc2lvbi1pZCddIHx8IG51bGxcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFNvdXJjZVZlcnNpb25JZChoZWFkZXJzOiBSZXNwb25zZUhlYWRlciA9IHt9KSB7XG4gIHJldHVybiBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS12ZXJzaW9uLWlkJ10gfHwgbnVsbFxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVFVGFnKGV0YWcgPSAnJyk6IHN0cmluZyB7XG4gIGNvbnN0IHJlcGxhY2VDaGFyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAnXCInOiAnJyxcbiAgICAnJnF1b3Q7JzogJycsXG4gICAgJyYjMzQ7JzogJycsXG4gICAgJyZRVU9UOyc6ICcnLFxuICAgICcmI3gwMDAyMic6ICcnLFxuICB9XG4gIHJldHVybiBldGFnLnJlcGxhY2UoL14oXCJ8JnF1b3Q7fCYjMzQ7KXwoXCJ8JnF1b3Q7fCYjMzQ7KSQvZywgKG0pID0+IHJlcGxhY2VDaGFyc1ttXSBhcyBzdHJpbmcpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0b01kNShwYXlsb2FkOiBCaW5hcnkpOiBzdHJpbmcge1xuICAvLyB1c2Ugc3RyaW5nIGZyb20gYnJvd3NlciBhbmQgYnVmZmVyIGZyb20gbm9kZWpzXG4gIC8vIGJyb3dzZXIgc3VwcG9ydCBpcyB0ZXN0ZWQgb25seSBhZ2FpbnN0IG1pbmlvIHNlcnZlclxuICByZXR1cm4gY3J5cHRvLmNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShCdWZmZXIuZnJvbShwYXlsb2FkKSkuZGlnZXN0KCkudG9TdHJpbmcoJ2Jhc2U2NCcpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0b1NoYTI1NihwYXlsb2FkOiBCaW5hcnkpOiBzdHJpbmcge1xuICByZXR1cm4gY3J5cHRvLmNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShwYXlsb2FkKS5kaWdlc3QoJ2hleCcpXG59XG5cbi8qKlxuICogdG9BcnJheSByZXR1cm5zIGEgc2luZ2xlIGVsZW1lbnQgYXJyYXkgd2l0aCBwYXJhbSBiZWluZyB0aGUgZWxlbWVudCxcbiAqIGlmIHBhcmFtIGlzIGp1c3QgYSBzdHJpbmcsIGFuZCByZXR1cm5zICdwYXJhbScgYmFjayBpZiBpdCBpcyBhbiBhcnJheVxuICogU28sIGl0IG1ha2VzIHN1cmUgcGFyYW0gaXMgYWx3YXlzIGFuIGFycmF5XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0b0FycmF5PFQgPSB1bmtub3duPihwYXJhbTogVCB8IFRbXSk6IEFycmF5PFQ+IHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHBhcmFtKSkge1xuICAgIHJldHVybiBbcGFyYW1dIGFzIFRbXVxuICB9XG4gIHJldHVybiBwYXJhbVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVPYmplY3RLZXkob2JqZWN0TmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgLy8gKyBzeW1ib2wgY2hhcmFjdGVycyBhcmUgbm90IGRlY29kZWQgYXMgc3BhY2VzIGluIEpTLiBzbyByZXBsYWNlIHRoZW0gZmlyc3QgYW5kIGRlY29kZSB0byBnZXQgdGhlIGNvcnJlY3QgcmVzdWx0LlxuICBjb25zdCBhc1N0ck5hbWUgPSAob2JqZWN0TmFtZSA/IG9iamVjdE5hbWUudG9TdHJpbmcoKSA6ICcnKS5yZXBsYWNlKC9cXCsvZywgJyAnKVxuICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KGFzU3RyTmFtZSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplU2l6ZShzaXplPzogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHNpemUgPyBOdW1iZXIucGFyc2VJbnQoc2l6ZSkgOiB1bmRlZmluZWRcbn1cblxuZXhwb3J0IGNvbnN0IFBBUlRfQ09OU1RSQUlOVFMgPSB7XG4gIC8vIGFic01pblBhcnRTaXplIC0gYWJzb2x1dGUgbWluaW11bSBwYXJ0IHNpemUgKDUgTWlCKVxuICBBQlNfTUlOX1BBUlRfU0laRTogMTAyNCAqIDEwMjQgKiA1LFxuICAvLyBNSU5fUEFSVF9TSVpFIC0gbWluaW11bSBwYXJ0IHNpemUgMTZNaUIgcGVyIG9iamVjdCBhZnRlciB3aGljaFxuICBNSU5fUEFSVF9TSVpFOiAxMDI0ICogMTAyNCAqIDE2LFxuICAvLyBNQVhfUEFSVFNfQ09VTlQgLSBtYXhpbXVtIG51bWJlciBvZiBwYXJ0cyBmb3IgYSBzaW5nbGUgbXVsdGlwYXJ0IHNlc3Npb24uXG4gIE1BWF9QQVJUU19DT1VOVDogMTAwMDAsXG4gIC8vIE1BWF9QQVJUX1NJWkUgLSBtYXhpbXVtIHBhcnQgc2l6ZSA1R2lCIGZvciBhIHNpbmdsZSBtdWx0aXBhcnQgdXBsb2FkXG4gIC8vIG9wZXJhdGlvbi5cbiAgTUFYX1BBUlRfU0laRTogMTAyNCAqIDEwMjQgKiAxMDI0ICogNSxcbiAgLy8gTUFYX1NJTkdMRV9QVVRfT0JKRUNUX1NJWkUgLSBtYXhpbXVtIHNpemUgNUdpQiBvZiBvYmplY3QgcGVyIFBVVFxuICAvLyBvcGVyYXRpb24uXG4gIE1BWF9TSU5HTEVfUFVUX09CSkVDVF9TSVpFOiAxMDI0ICogMTAyNCAqIDEwMjQgKiA1LFxuICAvLyBNQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSAtIG1heGltdW0gc2l6ZSA1VGlCIG9mIG9iamVjdCBmb3JcbiAgLy8gTXVsdGlwYXJ0IG9wZXJhdGlvbi5cbiAgTUFYX01VTFRJUEFSVF9QVVRfT0JKRUNUX1NJWkU6IDEwMjQgKiAxMDI0ICogMTAyNCAqIDEwMjQgKiA1LFxufVxuXG5jb25zdCBHRU5FUklDX1NTRV9IRUFERVIgPSAnWC1BbXotU2VydmVyLVNpZGUtRW5jcnlwdGlvbidcblxuY29uc3QgRU5DUllQVElPTl9IRUFERVJTID0ge1xuICAvLyBzc2VHZW5lcmljSGVhZGVyIGlzIHRoZSBBV1MgU1NFIGhlYWRlciB1c2VkIGZvciBTU0UtUzMgYW5kIFNTRS1LTVMuXG4gIHNzZUdlbmVyaWNIZWFkZXI6IEdFTkVSSUNfU1NFX0hFQURFUixcbiAgLy8gc3NlS21zS2V5SUQgaXMgdGhlIEFXUyBTU0UtS01TIGtleSBpZC5cbiAgc3NlS21zS2V5SUQ6IEdFTkVSSUNfU1NFX0hFQURFUiArICctQXdzLUttcy1LZXktSWQnLFxufSBhcyBjb25zdFxuXG4vKipcbiAqIFJldHVybiBFbmNyeXB0aW9uIGhlYWRlcnNcbiAqIEBwYXJhbSBlbmNDb25maWdcbiAqIEByZXR1cm5zIGFuIG9iamVjdCB3aXRoIGtleSB2YWx1ZSBwYWlycyB0aGF0IGNhbiBiZSB1c2VkIGluIGhlYWRlcnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRFbmNyeXB0aW9uSGVhZGVycyhlbmNDb25maWc6IEVuY3J5cHRpb24pOiBSZXF1ZXN0SGVhZGVycyB7XG4gIGNvbnN0IGVuY1R5cGUgPSBlbmNDb25maWcudHlwZVxuXG4gIGlmICghaXNFbXB0eShlbmNUeXBlKSkge1xuICAgIGlmIChlbmNUeXBlID09PSBFTkNSWVBUSU9OX1RZUEVTLlNTRUMpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIFtFTkNSWVBUSU9OX0hFQURFUlMuc3NlR2VuZXJpY0hlYWRlcl06ICdBRVMyNTYnLFxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZW5jVHlwZSA9PT0gRU5DUllQVElPTl9UWVBFUy5LTVMpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIFtFTkNSWVBUSU9OX0hFQURFUlMuc3NlR2VuZXJpY0hlYWRlcl06IGVuY0NvbmZpZy5TU0VBbGdvcml0aG0sXG4gICAgICAgIFtFTkNSWVBUSU9OX0hFQURFUlMuc3NlS21zS2V5SURdOiBlbmNDb25maWcuS01TTWFzdGVyS2V5SUQsXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHt9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJ0c1JlcXVpcmVkKHNpemU6IG51bWJlcik6IG51bWJlciB7XG4gIGNvbnN0IG1heFBhcnRTaXplID0gUEFSVF9DT05TVFJBSU5UUy5NQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSAvIChQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVCAtIDEpXG4gIGxldCByZXF1aXJlZFBhcnRTaXplID0gc2l6ZSAvIG1heFBhcnRTaXplXG4gIGlmIChzaXplICUgbWF4UGFydFNpemUgPiAwKSB7XG4gICAgcmVxdWlyZWRQYXJ0U2l6ZSsrXG4gIH1cbiAgcmVxdWlyZWRQYXJ0U2l6ZSA9IE1hdGgudHJ1bmMocmVxdWlyZWRQYXJ0U2l6ZSlcbiAgcmV0dXJuIHJlcXVpcmVkUGFydFNpemVcbn1cblxuLyoqXG4gKiBjYWxjdWxhdGVFdmVuU3BsaXRzIC0gY29tcHV0ZXMgc3BsaXRzIGZvciBhIHNvdXJjZSBhbmQgcmV0dXJuc1xuICogc3RhcnQgYW5kIGVuZCBpbmRleCBzbGljZXMuIFNwbGl0cyBoYXBwZW4gZXZlbmx5IHRvIGJlIHN1cmUgdGhhdCBub1xuICogcGFydCBpcyBsZXNzIHRoYW4gNU1pQiwgYXMgdGhhdCBjb3VsZCBmYWlsIHRoZSBtdWx0aXBhcnQgcmVxdWVzdCBpZlxuICogaXQgaXMgbm90IHRoZSBsYXN0IHBhcnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYWxjdWxhdGVFdmVuU3BsaXRzPFQgZXh0ZW5kcyB7IFN0YXJ0PzogbnVtYmVyIH0+KFxuICBzaXplOiBudW1iZXIsXG4gIG9iakluZm86IFQsXG4pOiB7XG4gIHN0YXJ0SW5kZXg6IG51bWJlcltdXG4gIG9iakluZm86IFRcbiAgZW5kSW5kZXg6IG51bWJlcltdXG59IHwgbnVsbCB7XG4gIGlmIChzaXplID09PSAwKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuICBjb25zdCByZXFQYXJ0cyA9IHBhcnRzUmVxdWlyZWQoc2l6ZSlcbiAgY29uc3Qgc3RhcnRJbmRleFBhcnRzOiBudW1iZXJbXSA9IFtdXG4gIGNvbnN0IGVuZEluZGV4UGFydHM6IG51bWJlcltdID0gW11cblxuICBsZXQgc3RhcnQgPSBvYmpJbmZvLlN0YXJ0XG4gIGlmIChpc0VtcHR5KHN0YXJ0KSB8fCBzdGFydCA9PT0gLTEpIHtcbiAgICBzdGFydCA9IDBcbiAgfVxuICBjb25zdCBkaXZpc29yVmFsdWUgPSBNYXRoLnRydW5jKHNpemUgLyByZXFQYXJ0cylcblxuICBjb25zdCByZW1pbmRlclZhbHVlID0gc2l6ZSAlIHJlcVBhcnRzXG5cbiAgbGV0IG5leHRTdGFydCA9IHN0YXJ0XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXFQYXJ0czsgaSsrKSB7XG4gICAgbGV0IGN1clBhcnRTaXplID0gZGl2aXNvclZhbHVlXG4gICAgaWYgKGkgPCByZW1pbmRlclZhbHVlKSB7XG4gICAgICBjdXJQYXJ0U2l6ZSsrXG4gICAgfVxuXG4gICAgY29uc3QgY3VycmVudFN0YXJ0ID0gbmV4dFN0YXJ0XG4gICAgY29uc3QgY3VycmVudEVuZCA9IGN1cnJlbnRTdGFydCArIGN1clBhcnRTaXplIC0gMVxuICAgIG5leHRTdGFydCA9IGN1cnJlbnRFbmQgKyAxXG5cbiAgICBzdGFydEluZGV4UGFydHMucHVzaChjdXJyZW50U3RhcnQpXG4gICAgZW5kSW5kZXhQYXJ0cy5wdXNoKGN1cnJlbnRFbmQpXG4gIH1cblxuICByZXR1cm4geyBzdGFydEluZGV4OiBzdGFydEluZGV4UGFydHMsIGVuZEluZGV4OiBlbmRJbmRleFBhcnRzLCBvYmpJbmZvOiBvYmpJbmZvIH1cbn1cblxuY29uc3QgZnhwID0gbmV3IFhNTFBhcnNlcigpXG5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZXhwbGljaXQtYW55XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VYbWwoeG1sOiBzdHJpbmcpOiBhbnkge1xuICBjb25zdCByZXN1bHQgPSBmeHAucGFyc2UoeG1sKVxuICBpZiAocmVzdWx0LkVycm9yKSB7XG4gICAgdGhyb3cgcmVzdWx0LkVycm9yXG4gIH1cblxuICByZXR1cm4gcmVzdWx0XG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBZ0JBLElBQUFBLE1BQUEsR0FBQUMsdUJBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFDLE1BQUEsR0FBQUYsdUJBQUEsQ0FBQUMsT0FBQTtBQUVBLElBQUFFLGNBQUEsR0FBQUYsT0FBQTtBQUNBLElBQUFHLE9BQUEsR0FBQUgsT0FBQTtBQUNBLElBQUFJLE9BQUEsR0FBQUosT0FBQTtBQUNBLElBQUFLLElBQUEsR0FBQU4sdUJBQUEsQ0FBQUMsT0FBQTtBQUdBLElBQUFNLEtBQUEsR0FBQU4sT0FBQTtBQUE0QyxTQUFBTyx5QkFBQUMsV0FBQSxlQUFBQyxPQUFBLGtDQUFBQyxpQkFBQSxPQUFBRCxPQUFBLFFBQUFFLGdCQUFBLE9BQUFGLE9BQUEsWUFBQUYsd0JBQUEsWUFBQUEsQ0FBQUMs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