"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  Client: true,
  CopyConditions: true,
  PostPolicy: true
};
var fs = _interopRequireWildcard(require("fs"), true);
var path = _interopRequireWildcard(require("path"), true);
var Stream = _interopRequireWildcard(require("stream"), true);
var _async = require("async");
var _blockStream = require("block-stream2");
var _lodash = require("lodash");
var querystring = _interopRequireWildcard(require("query-string"), true);
var _webEncoding = require("web-encoding");
var _xml = require("xml");
var _xml2js = require("xml2js");
var errors = _interopRequireWildcard(require("./errors.js"), true);
var _helpers = require("./helpers.js");
Object.keys(_helpers).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _helpers[key]) return;
  exports[key] = _helpers[key];
});
var _callbackify = require("./internal/callbackify.js");
var _client = require("./internal/client.js");
var _copyConditions = require("./internal/copy-conditions.js");
exports.CopyConditions = _copyConditions.CopyConditions;
var _helper = require("./internal/helper.js");
var _postPolicy = require("./internal/post-policy.js");
exports.PostPolicy = _postPolicy.PostPolicy;
var _type = require("./internal/type.js");
var _notification = require("./notification.js");
Object.keys(_notification).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _notification[key]) return;
  exports[key] = _notification[key];
});
var _objectUploader = require("./object-uploader.js");
var _promisify = require("./promisify.js");
var _signing = require("./signing.js");
var transformers = _interopRequireWildcard(require("./transformers.js"), true);
var _xmlParsers = require("./xml-parsers.js");
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

class Client extends _client.TypedClient {
  // Set application specific information.
  //
  // Generates User-Agent in the following style.
  //
  //       MinIO (OS; ARCH) LIB/VER APP/VER
  //
  // __Arguments__
  // * `appName` _string_ - Application name.
  // * `appVersion` _string_ - Application version.
  setAppInfo(appName, appVersion) {
    if (!(0, _helper.isString)(appName)) {
      throw new TypeError(`Invalid appName: ${appName}`);
    }
    if (appName.trim() === '') {
      throw new errors.InvalidArgumentError('Input appName cannot be empty.');
    }
    if (!(0, _helper.isString)(appVersion)) {
      throw new TypeError(`Invalid appVersion: ${appVersion}`);
    }
    if (appVersion.trim() === '') {
      throw new errors.InvalidArgumentError('Input appVersion cannot be empty.');
    }
    this.userAgent = `${this.userAgent} ${appName}/${appVersion}`;
  }

  // Calculate part size given the object size. Part size will be atleast this.partSize
  calculatePartSize(size) {
    if (!(0, _helper.isNumber)(size)) {
      throw new TypeError('size should be of type "number"');
    }
    if (size > this.maxObjectSize) {
      throw new TypeError(`size should not be more than ${this.maxObjectSize}`);
    }
    if (this.overRidePartSize) {
      return this.partSize;
    }
    var partSize = this.partSize;
    for (;;) {
      // while(true) {...} throws linting error.
      // If partSize is big enough to accomodate the object size, then use it.
      if (partSize * 10000 > size) {
        return partSize;
      }
      // Try part sizes as 64MB, 80MB, 96MB etc.
      partSize += 16 * 1024 * 1024;
    }
  }

  // Creates the bucket `bucketName`.
  //
  // __Arguments__
  // * `bucketName` _string_ - Name of the bucket
  // * `region` _string_ - region valid values are _us-west-1_, _us-west-2_,  _eu-west-1_, _eu-central-1_, _ap-southeast-1_, _ap-northeast-1_, _ap-southeast-2_, _sa-east-1_.
  // * `makeOpts` _object_ - Options to create a bucket. e.g {ObjectLocking:true} (Optional)
  // * `callback(err)` _function_ - callback function with `err` as the error argument. `err` is null if the bucket is successfully created.
  makeBucket(bucketName, region, makeOpts = {}, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    // Backward Compatibility
    if ((0, _helper.isObject)(region)) {
      cb = makeOpts;
      makeOpts = region;
      region = '';
    }
    if ((0, _helper.isFunction)(region)) {
      cb = region;
      region = '';
      makeOpts = {};
    }
    if ((0, _helper.isFunction)(makeOpts)) {
      cb = makeOpts;
      makeOpts = {};
    }
    if (!(0, _helper.isString)(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (!(0, _helper.isObject)(makeOpts)) {
      throw new TypeError('makeOpts should be of type "object"');
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var payload = '';

    // Region already set in constructor, validate if
    // caller requested bucket location is same.
    if (region && this.region) {
      if (region !== this.region) {
        throw new errors.InvalidArgumentError(`Configured region ${this.region}, requested ${region}`);
      }
    }
    // sending makeBucket request with XML containing 'us-east-1' fails. For
    // default region server expects the request without body
    if (region && region !== _helpers.DEFAULT_REGION) {
      var createBucketConfiguration = [];
      createBucketConfiguration.push({
        _attr: {
          xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/'
        }
      });
      createBucketConfiguration.push({
        LocationConstraint: region
      });
      var payloadObject = {
        CreateBucketConfiguration: createBucketConfiguration
      };
      payload = _xml(payloadObject);
    }
    var method = 'PUT';
    var headers = {};
    if (makeOpts.ObjectLocking) {
      headers['x-amz-bucket-object-lock-enabled'] = true;
    }
    if (!region) {
      region = _helpers.DEFAULT_REGION;
    }
    const processWithRetry = err => {
      if (err && (region === '' || region === _helpers.DEFAULT_REGION)) {
        if (err.code === 'AuthorizationHeaderMalformed' && err.region !== '') {
          // Retry with region returned as part of error
          this.makeRequest({
            method,
            bucketName,
            headers
          }, payload, [200], err.region, false, cb);
        } else {
          return cb && cb(err);
        }
      }
      return cb && cb(err);
    };
    this.makeRequest({
      method,
      bucketName,
      headers
    }, payload, [200], region, false, processWithRetry);
  }

  // Returns a stream that emits objects that are partially uploaded.
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `prefix` _string_: prefix of the object names that are partially uploaded (optional, default `''`)
  // * `recursive` _bool_: directory style listing when false, recursive listing when true (optional, default `false`)
  //
  // __Return Value__
  // * `stream` _Stream_ : emits objects of the format:
  //   * `object.key` _string_: name of the object
  //   * `object.uploadId` _string_: upload ID of the object
  //   * `object.size` _Integer_: size of the partially uploaded object
  listIncompleteUploads(bucket, prefix, recursive) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (!(0, _helper.isValidBucketName)(bucket)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucket);
    }
    if (!(0, _helper.isValidPrefix)(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!(0, _helper.isBoolean)(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    var delimiter = recursive ? '' : '/';
    var keyMarker = '';
    var uploadIdMarker = '';
    var uploads = [];
    var ended = false;
    var readStream = Stream.Readable({
      objectMode: true
    });
    readStream._read = () => {
      // push one upload info per _read()
      if (uploads.length) {
        return readStream.push(uploads.shift());
      }
      if (ended) {
        return readStream.push(null);
      }
      this.listIncompleteUploadsQuery(bucket, prefix, keyMarker, uploadIdMarker, delimiter).on('error', e => readStream.emit('error', e)).on('data', result => {
        result.prefixes.forEach(prefix => uploads.push(prefix));
        _async.eachSeries(result.uploads, (upload, cb) => {
          // for each incomplete upload add the sizes of its uploaded parts
          this.listParts(bucket, upload.key, upload.uploadId).then(parts => {
            upload.size = parts.reduce((acc, item) => acc + item.size, 0);
            uploads.push(upload);
            cb();
          }, cb);
        }, err => {
          if (err) {
            readStream.emit('error', err);
            return;
          }
          if (result.isTruncated) {
            keyMarker = result.nextKeyMarker;
            uploadIdMarker = result.nextUploadIdMarker;
          } else {
            ended = true;
          }
          readStream._read();
        });
      });
    };
    return readStream;
  }

  // To check if a bucket already exists.
  //
  // __Arguments__
  // * `bucketName` _string_ : name of the bucket
  // * `callback(err)` _function_ : `err` is `null` if the bucket exists
  bucketExists(bucketName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var method = 'HEAD';
    this.makeRequest({
      method,
      bucketName
    }, '', [200], '', false, err => {
      if (err) {
        if (err.code == 'NoSuchBucket' || err.code == 'NotFound') {
          return cb(null, false);
        }
        return cb(err);
      }
      cb(null, true);
    });
  }

  // Remove the partially uploaded object.
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `objectName` _string_: name of the object
  // * `callback(err)` _function_: callback function is called with non `null` value in case of error
  removeIncompleteUpload(bucketName, objectName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.IsValidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var removeUploadId;
    _async.during(cb => {
      this.findUploadId(bucketName, objectName, (e, uploadId) => {
        if (e) {
          return cb(e);
        }
        removeUploadId = uploadId;
        cb(null, uploadId);
      });
    }, cb => {
      var method = 'DELETE';
      var query = `uploadId=${removeUploadId}`;
      this.makeRequest({
        method,
        bucketName,
        objectName,
        query
      }, '', [204], '', false, e => cb(e));
    }, cb);
  }

  // Callback is called with `error` in case of error or `null` in case of success
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `objectName` _string_: name of the object
  // * `filePath` _string_: path to which the object data will be written to
  // * `getOpts` _object_: Version of the object in the form `{versionId:'my-uuid'}`. Default is `{}`. (optional)
  // * `callback(err)` _function_: callback is called with `err` in case of error.
  fGetObject(bucketName, objectName, filePath, getOpts = {}, cb) {
    // Input validation.
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    // Backward Compatibility
    if ((0, _helper.isFunction)(getOpts)) {
      cb = getOpts;
      getOpts = {};
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }

    // Internal data.
    var partFile;
    var partFileStream;
    var objStat;

    // Rename wrapper.
    var rename = err => {
      if (err) {
        return cb(err);
      }
      fs.rename(partFile, filePath, cb);
    };
    _async.waterfall([cb => this.statObject(bucketName, objectName, getOpts, cb), (result, cb) => {
      objStat = result;
      // Create any missing top level directories.
      fs.mkdir(path.dirname(filePath), {
        recursive: true
      }, err => cb(err));
    }, cb => {
      partFile = `${filePath}.${objStat.etag}.part.minio`;
      fs.stat(partFile, (e, stats) => {
        var offset = 0;
        if (e) {
          partFileStream = fs.createWriteStream(partFile, {
            flags: 'w'
          });
        } else {
          if (objStat.size === stats.size) {
            return rename();
          }
          offset = stats.size;
          partFileStream = fs.createWriteStream(partFile, {
            flags: 'a'
          });
        }
        this.getPartialObject(bucketName, objectName, offset, 0, getOpts, cb);
      });
    }, (downloadStream, cb) => {
      (0, _helper.pipesetup)(downloadStream, partFileStream).on('error', e => cb(e)).on('finish', cb);
    }, cb => fs.stat(partFile, cb), (stats, cb) => {
      if (stats.size === objStat.size) {
        return cb();
      }
      cb(new Error('Size mismatch between downloaded file and the object'));
    }], rename);
  }

  // Callback is called with readable stream of the object content.
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `objectName` _string_: name of the object
  // * `getOpts` _object_: Version of the object in the form `{versionId:'my-uuid'}`. Default is `{}`. (optional)
  // * `callback(err, stream)` _function_: callback is called with `err` in case of error. `stream` is the object content stream
  getObject(bucketName, objectName, getOpts = {}, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    // Backward Compatibility
    if ((0, _helper.isFunction)(getOpts)) {
      cb = getOpts;
      getOpts = {};
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    this.getPartialObject(bucketName, objectName, 0, 0, getOpts, cb);
  }

  // Callback is called with readable stream of the partial object content.
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `objectName` _string_: name of the object
  // * `offset` _number_: offset of the object from where the stream will start
  // * `length` _number_: length of the object that will be read in the stream (optional, if not specified we read the rest of the file from the offset)
  // * `getOpts` _object_: Version of the object in the form `{versionId:'my-uuid'}`. Default is `{}`. (optional)
  // * `callback(err, stream)` _function_: callback is called with `err` in case of error. `stream` is the object content stream
  getPartialObject(bucketName, objectName, offset, length, getOpts = {}, cb) {
    if ((0, _helper.isFunction)(length)) {
      cb = length;
      length = 0;
    }
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isNumber)(offset)) {
      throw new TypeError('offset should be of type "number"');
    }
    if (!(0, _helper.isNumber)(length)) {
      throw new TypeError('length should be of type "number"');
    }
    // Backward Compatibility
    if ((0, _helper.isFunction)(getOpts)) {
      cb = getOpts;
      getOpts = {};
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var range = '';
    if (offset || length) {
      if (offset) {
        range = `bytes=${+offset}-`;
      } else {
        range = 'bytes=0-';
        offset = 0;
      }
      if (length) {
        range += `${+length + offset - 1}`;
      }
    }
    var headers = {};
    if (range !== '') {
      headers.range = range;
    }
    var expectedStatusCodes = [200];
    if (range) {
      expectedStatusCodes.push(206);
    }
    var method = 'GET';
    var query = querystring.stringify(getOpts);
    this.makeRequest({
      method,
      bucketName,
      objectName,
      headers,
      query
    }, '', expectedStatusCodes, '', true, cb);
  }

  // Uploads the object using contents from a file
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `objectName` _string_: name of the object
  // * `filePath` _string_: file path of the file to be uploaded
  // * `metaData` _Javascript Object_: metaData assosciated with the object
  // * `callback(err, objInfo)` _function_: non null `err` indicates error, `objInfo` _object_ which contains versionId and etag.
  fPutObject(bucketName, objectName, filePath, metaData, callback) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    if ((0, _helper.isFunction)(metaData)) {
      callback = metaData;
      metaData = {}; // Set metaData empty if no metaData provided.
    }

    if (!(0, _helper.isObject)(metaData)) {
      throw new TypeError('metaData should be of type "object"');
    }

    // Inserts correct `content-type` attribute based on metaData and filePath
    metaData = (0, _helper.insertContentType)(metaData, filePath);
    fs.lstat(filePath, (err, stat) => {
      if (err) {
        return callback(err);
      }
      return this.putObject(bucketName, objectName, fs.createReadStream(filePath), stat.size, metaData, callback);
    });
  }

  // Uploads the object.
  //
  // Uploading a stream
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `objectName` _string_: name of the object
  // * `stream` _Stream_: Readable stream
  // * `size` _number_: size of the object (optional)
  // * `callback(err, etag)` _function_: non null `err` indicates error, `etag` _string_ is the etag of the object uploaded.
  //
  // Uploading "Buffer" or "string"
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `objectName` _string_: name of the object
  // * `string or Buffer` _string_ or _Buffer_: string or buffer
  // * `callback(err, objInfo)` _function_: `err` is `null` in case of success and `info` will have the following object details:
  //   * `etag` _string_: etag of the object
  //   * `versionId` _string_: versionId of the object
  putObject(bucketName, objectName, stream, size, metaData, callback) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }

    // We'll need to shift arguments to the left because of size and metaData.
    if ((0, _helper.isFunction)(size)) {
      callback = size;
      metaData = {};
    } else if ((0, _helper.isFunction)(metaData)) {
      callback = metaData;
      metaData = {};
    }

    // We'll need to shift arguments to the left because of metaData
    // and size being optional.
    if ((0, _helper.isObject)(size)) {
      metaData = size;
    }

    // Ensures Metadata has appropriate prefix for A3 API
    metaData = (0, _helper.prependXAMZMeta)(metaData);
    if (typeof stream === 'string' || stream instanceof Buffer) {
      // Adapts the non-stream interface into a stream.
      size = stream.length;
      stream = (0, _helper.readableStream)(stream);
    } else if (!(0, _helper.isReadableStream)(stream)) {
      throw new TypeError('third argument should be of type "stream.Readable" or "Buffer" or "string"');
    }
    if (!(0, _helper.isFunction)(callback)) {
      throw new TypeError('callback should be of type "function"');
    }
    if ((0, _helper.isNumber)(size) && size < 0) {
      throw new errors.InvalidArgumentError(`size cannot be negative, given size: ${size}`);
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (!(0, _helper.isNumber)(size)) {
      size = this.maxObjectSize;
    }
    size = this.calculatePartSize(size);

    // s3 requires that all non-end chunks be at least `this.partSize`,
    // so we chunk the stream until we hit either that size or the end before
    // we flush it to s3.
    let chunker = new _blockStream({
      size,
      zeroPadding: false
    });

    // This is a Writable stream that can be written to in order to upload
    // to the specified bucket and object automatically.
    let uploader = new _objectUploader.ObjectUploader(this, bucketName, objectName, size, metaData, callback);
    // stream => chunker => uploader
    (0, _helper.pipesetup)(stream, chunker, uploader);
  }

  // Copy the object.
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `objectName` _string_: name of the object
  // * `srcObject` _string_: path of the source object to be copied
  // * `conditions` _CopyConditions_: copy conditions that needs to be satisfied (optional, default `null`)
  // * `callback(err, {etag, lastModified})` _function_: non null `err` indicates error, `etag` _string_ and `listModifed` _Date_ are respectively the etag and the last modified date of the newly copied object
  copyObjectV1(arg1, arg2, arg3, arg4, arg5) {
    var bucketName = arg1;
    var objectName = arg2;
    var srcObject = arg3;
    var conditions, cb;
    if (typeof arg4 == 'function' && arg5 === undefined) {
      conditions = null;
      cb = arg4;
    } else {
      conditions = arg4;
      cb = arg5;
    }
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(srcObject)) {
      throw new TypeError('srcObject should be of type "string"');
    }
    if (srcObject === '') {
      throw new errors.InvalidPrefixError(`Empty source prefix`);
    }
    if (conditions !== null && !(conditions instanceof _copyConditions.CopyConditions)) {
      throw new TypeError('conditions should be of type "CopyConditions"');
    }
    var headers = {};
    headers['x-amz-copy-source'] = (0, _helper.uriResourceEscape)(srcObject);
    if (conditions !== null) {
      if (conditions.modified !== '') {
        headers['x-amz-copy-source-if-modified-since'] = conditions.modified;
      }
      if (conditions.unmodified !== '') {
        headers['x-amz-copy-source-if-unmodified-since'] = conditions.unmodified;
      }
      if (conditions.matchETag !== '') {
        headers['x-amz-copy-source-if-match'] = conditions.matchETag;
      }
      if (conditions.matchEtagExcept !== '') {
        headers['x-amz-copy-source-if-none-match'] = conditions.matchETagExcept;
      }
    }
    var method = 'PUT';
    this.makeRequest({
      method,
      bucketName,
      objectName,
      headers
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      var transformer = transformers.getCopyObjectTransformer();
      (0, _helper.pipesetup)(response, transformer).on('error', e => cb(e)).on('data', data => cb(null, data));
    });
  }

  /**
   * Internal Method to perform copy of an object.
   * @param sourceConfig __object__   instance of CopySourceOptions @link ./helpers/CopySourceOptions
   * @param destConfig  __object__   instance of CopyDestinationOptions @link ./helpers/CopyDestinationOptions
   * @param cb __function__ called with null if there is an error
   * @returns Promise if no callack is passed.
   */
  copyObjectV2(sourceConfig, destConfig, cb) {
    if (!(sourceConfig instanceof _helpers.CopySourceOptions)) {
      throw new errors.InvalidArgumentError('sourceConfig should of type CopySourceOptions ');
    }
    if (!(destConfig instanceof _helpers.CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (!destConfig.validate()) {
      return false;
    }
    if (!destConfig.validate()) {
      return false;
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    const headers = Object.assign({}, sourceConfig.getHeaders(), destConfig.getHeaders());
    const bucketName = destConfig.Bucket;
    const objectName = destConfig.Object;
    const method = 'PUT';
    this.makeRequest({
      method,
      bucketName,
      objectName,
      headers
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      const transformer = transformers.getCopyObjectTransformer();
      (0, _helper.pipesetup)(response, transformer).on('error', e => cb(e)).on('data', data => {
        const resHeaders = response.headers;
        const copyObjResponse = {
          Bucket: destConfig.Bucket,
          Key: destConfig.Object,
          LastModified: data.LastModified,
          MetaData: (0, _helper.extractMetadata)(resHeaders),
          VersionId: (0, _helper.getVersionId)(resHeaders),
          SourceVersionId: (0, _helper.getSourceVersionId)(resHeaders),
          Etag: (0, _helper.sanitizeETag)(resHeaders.etag),
          Size: +resHeaders['content-length']
        };
        return cb(null, copyObjResponse);
      });
    });
  }

  // Backward compatibility for Copy Object API.
  copyObject(...allArgs) {
    if (allArgs[0] instanceof _helpers.CopySourceOptions && allArgs[1] instanceof _helpers.CopyDestinationOptions) {
      return this.copyObjectV2(...arguments);
    }
    return this.copyObjectV1(...arguments);
  }

  // list a batch of objects
  listObjectsQuery(bucketName, prefix, marker, listQueryOpts = {}) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isString)(marker)) {
      throw new TypeError('marker should be of type "string"');
    }
    let {
      Delimiter,
      MaxKeys,
      IncludeVersion
    } = listQueryOpts;
    if (!(0, _helper.isObject)(listQueryOpts)) {
      throw new TypeError('listQueryOpts should be of type "object"');
    }
    if (!(0, _helper.isString)(Delimiter)) {
      throw new TypeError('Delimiter should be of type "string"');
    }
    if (!(0, _helper.isNumber)(MaxKeys)) {
      throw new TypeError('MaxKeys should be of type "number"');
    }
    const queries = [];
    // escape every value in query string, except maxKeys
    queries.push(`prefix=${(0, _helper.uriEscape)(prefix)}`);
    queries.push(`delimiter=${(0, _helper.uriEscape)(Delimiter)}`);
    queries.push(`encoding-type=url`);
    if (IncludeVersion) {
      queries.push(`versions`);
    }
    if (marker) {
      marker = (0, _helper.uriEscape)(marker);
      if (IncludeVersion) {
        queries.push(`key-marker=${marker}`);
      } else {
        queries.push(`marker=${marker}`);
      }
    }

    // no need to escape maxKeys
    if (MaxKeys) {
      if (MaxKeys >= 1000) {
        MaxKeys = 1000;
      }
      queries.push(`max-keys=${MaxKeys}`);
    }
    queries.sort();
    var query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    var method = 'GET';
    var transformer = transformers.getListObjectsTransformer();
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return transformer.emit('error', e);
      }
      (0, _helper.pipesetup)(response, transformer);
    });
    return transformer;
  }

  // List the objects in the bucket.
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `prefix` _string_: the prefix of the objects that should be listed (optional, default `''`)
  // * `recursive` _bool_: `true` indicates recursive style listing and `false` indicates directory style listing delimited by '/'. (optional, default `false`)
  // * `listOpts _object_: query params to list object with below keys
  // *    listOpts.MaxKeys _int_ maximum number of keys to return
  // *    listOpts.IncludeVersion  _bool_ true|false to include versions.
  // __Return Value__
  // * `stream` _Stream_: stream emitting the objects in the bucket, the object is of the format:
  // * `obj.name` _string_: name of the object
  // * `obj.prefix` _string_: name of the object prefix
  // * `obj.size` _number_: size of the object
  // * `obj.etag` _string_: etag of the object
  // * `obj.lastModified` _Date_: modified time stamp
  // * `obj.isDeleteMarker` _boolean_: true if it is a delete marker
  // * `obj.versionId` _string_: versionId of the object
  listObjects(bucketName, prefix, recursive, listOpts = {}) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidPrefix)(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isBoolean)(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    if (!(0, _helper.isObject)(listOpts)) {
      throw new TypeError('listOpts should be of type "object"');
    }
    var marker = '';
    const listQueryOpts = {
      Delimiter: recursive ? '' : '/',
      // if recursive is false set delimiter to '/'
      MaxKeys: 1000,
      IncludeVersion: listOpts.IncludeVersion
    };
    var objects = [];
    var ended = false;
    var readStream = Stream.Readable({
      objectMode: true
    });
    readStream._read = () => {
      // push one object per _read()
      if (objects.length) {
        readStream.push(objects.shift());
        return;
      }
      if (ended) {
        return readStream.push(null);
      }
      // if there are no objects to push do query for the next batch of objects
      this.listObjectsQuery(bucketName, prefix, marker, listQueryOpts).on('error', e => readStream.emit('error', e)).on('data', result => {
        if (result.isTruncated) {
          marker = result.nextMarker || result.versionIdMarker;
        } else {
          ended = true;
        }
        objects = result.objects;
        readStream._read();
      });
    };
    return readStream;
  }

  // listObjectsV2Query - (List Objects V2) - List some or all (up to 1000) of the objects in a bucket.
  //
  // You can use the request parameters as selection criteria to return a subset of the objects in a bucket.
  // request parameters :-
  // * `bucketName` _string_: name of the bucket
  // * `prefix` _string_: Limits the response to keys that begin with the specified prefix.
  // * `continuation-token` _string_: Used to continue iterating over a set of objects.
  // * `delimiter` _string_: A delimiter is a character you use to group keys.
  // * `max-keys` _number_: Sets the maximum number of keys returned in the response body.
  // * `start-after` _string_: Specifies the key to start after when listing objects in a bucket.
  listObjectsV2Query(bucketName, prefix, continuationToken, delimiter, maxKeys, startAfter) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isString)(continuationToken)) {
      throw new TypeError('continuationToken should be of type "string"');
    }
    if (!(0, _helper.isString)(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    if (!(0, _helper.isNumber)(maxKeys)) {
      throw new TypeError('maxKeys should be of type "number"');
    }
    if (!(0, _helper.isString)(startAfter)) {
      throw new TypeError('startAfter should be of type "string"');
    }
    var queries = [];

    // Call for listing objects v2 API
    queries.push(`list-type=2`);
    queries.push(`encoding-type=url`);

    // escape every value in query string, except maxKeys
    queries.push(`prefix=${(0, _helper.uriEscape)(prefix)}`);
    queries.push(`delimiter=${(0, _helper.uriEscape)(delimiter)}`);
    if (continuationToken) {
      continuationToken = (0, _helper.uriEscape)(continuationToken);
      queries.push(`continuation-token=${continuationToken}`);
    }
    // Set start-after
    if (startAfter) {
      startAfter = (0, _helper.uriEscape)(startAfter);
      queries.push(`start-after=${startAfter}`);
    }
    // no need to escape maxKeys
    if (maxKeys) {
      if (maxKeys >= 1000) {
        maxKeys = 1000;
      }
      queries.push(`max-keys=${maxKeys}`);
    }
    queries.sort();
    var query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    var method = 'GET';
    var transformer = transformers.getListObjectsV2Transformer();
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return transformer.emit('error', e);
      }
      (0, _helper.pipesetup)(response, transformer);
    });
    return transformer;
  }

  // List the objects in the bucket using S3 ListObjects V2
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `prefix` _string_: the prefix of the objects that should be listed (optional, default `''`)
  // * `recursive` _bool_: `true` indicates recursive style listing and `false` indicates directory style listing delimited by '/'. (optional, default `false`)
  // * `startAfter` _string_: Specifies the key to start after when listing objects in a bucket. (optional, default `''`)
  //
  // __Return Value__
  // * `stream` _Stream_: stream emitting the objects in the bucket, the object is of the format:
  //   * `obj.name` _string_: name of the object
  //   * `obj.prefix` _string_: name of the object prefix
  //   * `obj.size` _number_: size of the object
  //   * `obj.etag` _string_: etag of the object
  //   * `obj.lastModified` _Date_: modified time stamp
  listObjectsV2(bucketName, prefix, recursive, startAfter) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (startAfter === undefined) {
      startAfter = '';
    }
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidPrefix)(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isBoolean)(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    if (!(0, _helper.isString)(startAfter)) {
      throw new TypeError('startAfter should be of type "string"');
    }
    // if recursive is false set delimiter to '/'
    var delimiter = recursive ? '' : '/';
    var continuationToken = '';
    var objects = [];
    var ended = false;
    var readStream = Stream.Readable({
      objectMode: true
    });
    readStream._read = () => {
      // push one object per _read()
      if (objects.length) {
        readStream.push(objects.shift());
        return;
      }
      if (ended) {
        return readStream.push(null);
      }
      // if there are no objects to push do query for the next batch of objects
      this.listObjectsV2Query(bucketName, prefix, continuationToken, delimiter, 1000, startAfter).on('error', e => readStream.emit('error', e)).on('data', result => {
        if (result.isTruncated) {
          continuationToken = result.nextContinuationToken;
        } else {
          ended = true;
        }
        objects = result.objects;
        readStream._read();
      });
    };
    return readStream;
  }

  // Remove all the objects residing in the objectsList.
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `objectsList` _array_: array of objects of one of the following:
  // *         List of Object names as array of strings which are object keys:  ['objectname1','objectname2']
  // *         List of Object name and versionId as an object:  [{name:"objectname",versionId:"my-version-id"}]

  removeObjects(bucketName, objectsList, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Array.isArray(objectsList)) {
      throw new errors.InvalidArgumentError('objectsList should be a list');
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    const maxEntries = 1000;
    const query = 'delete';
    const method = 'POST';
    let result = objectsList.reduce((result, entry) => {
      result.list.push(entry);
      if (result.list.length === maxEntries) {
        result.listOfList.push(result.list);
        result.list = [];
      }
      return result;
    }, {
      listOfList: [],
      list: []
    });
    if (result.list.length > 0) {
      result.listOfList.push(result.list);
    }
    const encoder = new _webEncoding.TextEncoder();
    const batchResults = [];
    _async.eachSeries(result.listOfList, (list, batchCb) => {
      var objects = [];
      list.forEach(function (value) {
        if ((0, _helper.isObject)(value)) {
          objects.push({
            Key: value.name,
            VersionId: value.versionId
          });
        } else {
          objects.push({
            Key: value
          });
        }
      });
      let deleteObjects = {
        Delete: {
          Quiet: true,
          Object: objects
        }
      };
      const builder = new _xml2js.Builder({
        headless: true
      });
      let payload = builder.buildObject(deleteObjects);
      payload = Buffer.from(encoder.encode(payload));
      const headers = {};
      headers['Content-MD5'] = (0, _helper.toMd5)(payload);
      let removeObjectsResult;
      this.makeRequest({
        method,
        bucketName,
        query,
        headers
      }, payload, [200], '', true, (e, response) => {
        if (e) {
          return batchCb(e);
        }
        (0, _helper.pipesetup)(response, transformers.removeObjectsTransformer()).on('data', data => {
          removeObjectsResult = data;
        }).on('error', e => {
          return batchCb(e, null);
        }).on('end', () => {
          batchResults.push(removeObjectsResult);
          return batchCb(null, removeObjectsResult);
        });
      });
    }, () => {
      cb(null, _lodash.flatten(batchResults));
    });
  }

  // Get the policy on a bucket or an object prefix.
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `callback(err, policy)` _function_: callback function
  getBucketPolicy(bucketName, cb) {
    // Validate arguments.
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    let method = 'GET';
    let query = 'policy';
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      let policy = Buffer.from('');
      (0, _helper.pipesetup)(response, transformers.getConcater()).on('data', data => policy = data).on('error', cb).on('end', () => {
        cb(null, policy.toString());
      });
    });
  }

  // Set the policy on a bucket or an object prefix.
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `bucketPolicy` _string_: bucket policy (JSON stringify'ed)
  // * `callback(err)` _function_: callback function
  setBucketPolicy(bucketName, policy, cb) {
    // Validate arguments.
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isString)(policy)) {
      throw new errors.InvalidBucketPolicyError(`Invalid bucket policy: ${policy} - must be "string"`);
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    let method = 'DELETE';
    let query = 'policy';
    if (policy) {
      method = 'PUT';
    }
    this.makeRequest({
      method,
      bucketName,
      query
    }, policy, [204], '', false, cb);
  }

  // Generate a generic presigned URL which can be
  // used for HTTP methods GET, PUT, HEAD and DELETE
  //
  // __Arguments__
  // * `method` _string_: name of the HTTP method
  // * `bucketName` _string_: name of the bucket
  // * `objectName` _string_: name of the object
  // * `expiry` _number_: expiry in seconds (optional, default 7 days)
  // * `reqParams` _object_: request parameters (optional) e.g {versionId:"10fa9946-3f64-4137-a58f-888065c0732e"}
  // * `requestDate` _Date_: A date object, the url will be issued at (optional)
  presignedUrl(method, bucketName, objectName, expires, reqParams, requestDate, cb) {
    if (this.anonymous) {
      throw new errors.AnonymousRequestError('Presigned ' + method + ' url cannot be generated for anonymous requests');
    }
    if ((0, _helper.isFunction)(requestDate)) {
      cb = requestDate;
      requestDate = new Date();
    }
    if ((0, _helper.isFunction)(reqParams)) {
      cb = reqParams;
      reqParams = {};
      requestDate = new Date();
    }
    if ((0, _helper.isFunction)(expires)) {
      cb = expires;
      reqParams = {};
      expires = 24 * 60 * 60 * 7; // 7 days in seconds
      requestDate = new Date();
    }
    if (!(0, _helper.isNumber)(expires)) {
      throw new TypeError('expires should be of type "number"');
    }
    if (!(0, _helper.isObject)(reqParams)) {
      throw new TypeError('reqParams should be of type "object"');
    }
    if (!(0, _helper.isValidDate)(requestDate)) {
      throw new TypeError('requestDate should be of type "Date" and valid');
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var query = querystring.stringify(reqParams);
    this.getBucketRegion(bucketName, (e, region) => {
      if (e) {
        return cb(e);
      }
      // This statement is added to ensure that we send error through
      // callback on presign failure.
      var url;
      var reqOptions = this.getRequestOptions({
        method,
        region,
        bucketName,
        objectName,
        query
      });
      this.checkAndRefreshCreds();
      try {
        url = (0, _signing.presignSignatureV4)(reqOptions, this.accessKey, this.secretKey, this.sessionToken, region, requestDate, expires);
      } catch (pe) {
        return cb(pe);
      }
      cb(null, url);
    });
  }

  // Generate a presigned URL for GET
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `objectName` _string_: name of the object
  // * `expiry` _number_: expiry in seconds (optional, default 7 days)
  // * `respHeaders` _object_: response headers to override or request params for query (optional) e.g {versionId:"10fa9946-3f64-4137-a58f-888065c0732e"}
  // * `requestDate` _Date_: A date object, the url will be issued at (optional)
  presignedGetObject(bucketName, objectName, expires, respHeaders, requestDate, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if ((0, _helper.isFunction)(respHeaders)) {
      cb = respHeaders;
      respHeaders = {};
      requestDate = new Date();
    }
    var validRespHeaders = ['response-content-type', 'response-content-language', 'response-expires', 'response-cache-control', 'response-content-disposition', 'response-content-encoding'];
    validRespHeaders.forEach(header => {
      if (respHeaders !== undefined && respHeaders[header] !== undefined && !(0, _helper.isString)(respHeaders[header])) {
        throw new TypeError(`response header ${header} should be of type "string"`);
      }
    });
    return this.presignedUrl('GET', bucketName, objectName, expires, respHeaders, requestDate, cb);
  }

  // Generate a presigned URL for PUT. Using this URL, the browser can upload to S3 only with the specified object name.
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `objectName` _string_: name of the object
  // * `expiry` _number_: expiry in seconds (optional, default 7 days)
  presignedPutObject(bucketName, objectName, expires, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.presignedUrl('PUT', bucketName, objectName, expires, cb);
  }

  // return PostPolicy object
  newPostPolicy() {
    return new _postPolicy.PostPolicy();
  }

  // presignedPostPolicy can be used in situations where we want more control on the upload than what
  // presignedPutObject() provides. i.e Using presignedPostPolicy we will be able to put policy restrictions
  // on the object's `name` `bucket` `expiry` `Content-Type` `Content-Disposition` `metaData`
  presignedPostPolicy(postPolicy, cb) {
    if (this.anonymous) {
      throw new errors.AnonymousRequestError('Presigned POST policy cannot be generated for anonymous requests');
    }
    if (!(0, _helper.isObject)(postPolicy)) {
      throw new TypeError('postPolicy should be of type "object"');
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('cb should be of type "function"');
    }
    this.getBucketRegion(postPolicy.formData.bucket, (e, region) => {
      if (e) {
        return cb(e);
      }
      var date = new Date();
      var dateStr = (0, _helper.makeDateLong)(date);
      this.checkAndRefreshCreds();
      if (!postPolicy.policy.expiration) {
        // 'expiration' is mandatory field for S3.
        // Set default expiration date of 7 days.
        var expires = new Date();
        expires.setSeconds(24 * 60 * 60 * 7);
        postPolicy.setExpires(expires);
      }
      postPolicy.policy.conditions.push(['eq', '$x-amz-date', dateStr]);
      postPolicy.formData['x-amz-date'] = dateStr;
      postPolicy.policy.conditions.push(['eq', '$x-amz-algorithm', 'AWS4-HMAC-SHA256']);
      postPolicy.formData['x-amz-algorithm'] = 'AWS4-HMAC-SHA256';
      postPolicy.policy.conditions.push(['eq', '$x-amz-credential', this.accessKey + '/' + (0, _helper.getScope)(region, date)]);
      postPolicy.formData['x-amz-credential'] = this.accessKey + '/' + (0, _helper.getScope)(region, date);
      if (this.sessionToken) {
        postPolicy.policy.conditions.push(['eq', '$x-amz-security-token', this.sessionToken]);
        postPolicy.formData['x-amz-security-token'] = this.sessionToken;
      }
      var policyBase64 = Buffer.from(JSON.stringify(postPolicy.policy)).toString('base64');
      postPolicy.formData.policy = policyBase64;
      var signature = (0, _signing.postPresignSignatureV4)(region, date, this.secretKey, policyBase64);
      postPolicy.formData['x-amz-signature'] = signature;
      var opts = {};
      opts.region = region;
      opts.bucketName = postPolicy.formData.bucket;
      var reqOptions = this.getRequestOptions(opts);
      var portStr = this.port == 80 || this.port === 443 ? '' : `:${this.port.toString()}`;
      var urlStr = `${reqOptions.protocol}//${reqOptions.host}${portStr}${reqOptions.path}`;
      cb(null, {
        postURL: urlStr,
        formData: postPolicy.formData
      });
    });
  }

  // Complete the multipart upload. After all the parts are uploaded issuing
  // this call will aggregate the parts on the server into a single object.
  completeMultipartUpload(bucketName, objectName, uploadId, etags, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!(0, _helper.isObject)(etags)) {
      throw new TypeError('etags should be of type "Array"');
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('cb should be of type "function"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    var method = 'POST';
    var query = `uploadId=${(0, _helper.uriEscape)(uploadId)}`;
    var parts = [];
    etags.forEach(element => {
      parts.push({
        Part: [{
          PartNumber: element.part
        }, {
          ETag: element.etag
        }]
      });
    });
    var payloadObject = {
      CompleteMultipartUpload: parts
    };
    var payload = _xml(payloadObject);
    this.makeRequest({
      method,
      bucketName,
      objectName,
      query
    }, payload, [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      var transformer = transformers.getCompleteMultipartTransformer();
      (0, _helper.pipesetup)(response, transformer).on('error', e => cb(e)).on('data', result => {
        if (result.errCode) {
          // Multipart Complete API returns an error XML after a 200 http status
          cb(new errors.S3Error(result.errMessage));
        } else {
          const completeMultipartResult = {
            etag: result.etag,
            versionId: (0, _helper.getVersionId)(response.headers)
          };
          cb(null, completeMultipartResult);
        }
      });
    });
  }

  // Called by listIncompleteUploads to fetch a batch of incomplete uploads.
  listIncompleteUploadsQuery(bucketName, prefix, keyMarker, uploadIdMarker, delimiter) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isString)(keyMarker)) {
      throw new TypeError('keyMarker should be of type "string"');
    }
    if (!(0, _helper.isString)(uploadIdMarker)) {
      throw new TypeError('uploadIdMarker should be of type "string"');
    }
    if (!(0, _helper.isString)(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    var queries = [];
    queries.push(`prefix=${(0, _helper.uriEscape)(prefix)}`);
    queries.push(`delimiter=${(0, _helper.uriEscape)(delimiter)}`);
    if (keyMarker) {
      keyMarker = (0, _helper.uriEscape)(keyMarker);
      queries.push(`key-marker=${keyMarker}`);
    }
    if (uploadIdMarker) {
      queries.push(`upload-id-marker=${uploadIdMarker}`);
    }
    var maxUploads = 1000;
    queries.push(`max-uploads=${maxUploads}`);
    queries.sort();
    queries.unshift('uploads');
    var query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    var method = 'GET';
    var transformer = transformers.getListMultipartTransformer();
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return transformer.emit('error', e);
      }
      (0, _helper.pipesetup)(response, transformer);
    });
    return transformer;
  }

  // Find uploadId of an incomplete upload.
  findUploadId(bucketName, objectName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('cb should be of type "function"');
    }
    var latestUpload;
    var listNext = (keyMarker, uploadIdMarker) => {
      this.listIncompleteUploadsQuery(bucketName, objectName, keyMarker, uploadIdMarker, '').on('error', e => cb(e)).on('data', result => {
        result.uploads.forEach(upload => {
          if (upload.key === objectName) {
            if (!latestUpload || upload.initiated.getTime() > latestUpload.initiated.getTime()) {
              latestUpload = upload;
              return;
            }
          }
        });
        if (result.isTruncated) {
          listNext(result.nextKeyMarker, result.nextUploadIdMarker);
          return;
        }
        if (latestUpload) {
          return cb(null, latestUpload.uploadId);
        }
        cb(null, undefined);
      });
    };
    listNext('', '');
  }

  // Remove all the notification configurations in the S3 provider
  setBucketNotification(bucketName, config, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isObject)(config)) {
      throw new TypeError('notification config should be of type "Object"');
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var method = 'PUT';
    var query = 'notification';
    var builder = new _xml2js.Builder({
      rootName: 'NotificationConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    var payload = builder.buildObject(config);
    this.makeRequest({
      method,
      bucketName,
      query
    }, payload, [200], '', false, cb);
  }
  removeAllBucketNotification(bucketName, cb) {
    this.setBucketNotification(bucketName, new _notification.NotificationConfig(), cb);
  }

  // Return the list of notification configurations stored
  // in the S3 provider
  getBucketNotification(bucketName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var method = 'GET';
    var query = 'notification';
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      var transformer = transformers.getBucketNotificationTransformer();
      var bucketNotification;
      (0, _helper.pipesetup)(response, transformer).on('data', result => bucketNotification = result).on('error', e => cb(e)).on('end', () => cb(null, bucketNotification));
    });
  }

  // Listens for bucket notifications. Returns an EventEmitter.
  listenBucketNotification(bucketName, prefix, suffix, events) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix must be of type string');
    }
    if (!(0, _helper.isString)(suffix)) {
      throw new TypeError('suffix must be of type string');
    }
    if (!Array.isArray(events)) {
      throw new TypeError('events must be of type Array');
    }
    let listener = new _notification.NotificationPoller(this, bucketName, prefix, suffix, events);
    listener.start();
    return listener;
  }
  getBucketVersioning(bucketName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new errors.InvalidArgumentError('callback should be of type "function"');
    }
    var method = 'GET';
    var query = 'versioning';
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      let versionConfig = Buffer.from('');
      (0, _helper.pipesetup)(response, transformers.bucketVersioningTransformer()).on('data', data => {
        versionConfig = data;
      }).on('error', cb).on('end', () => {
        cb(null, versionConfig);
      });
    });
  }
  setBucketVersioning(bucketName, versionConfig, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Object.keys(versionConfig).length) {
      throw new errors.InvalidArgumentError('versionConfig should be of type "object"');
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var method = 'PUT';
    var query = 'versioning';
    var builder = new _xml2js.Builder({
      rootName: 'VersioningConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    var payload = builder.buildObject(versionConfig);
    this.makeRequest({
      method,
      bucketName,
      query
    }, payload, [200], '', false, cb);
  }

  /** To set Tags on a bucket or object based on the params
   *  __Arguments__
   * taggingParams _object_ Which contains the following properties
   *  bucketName _string_,
   *  objectName _string_ (Optional),
   *  tags _object_ of the form {'<tag-key-1>':'<tag-value-1>','<tag-key-2>':'<tag-value-2>'}
   *  putOpts _object_ (Optional) e.g {versionId:"my-object-version-id"},
   *  cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  setTagging(taggingParams) {
    const {
      bucketName,
      objectName,
      tags,
      putOpts = {},
      cb
    } = taggingParams;
    const method = 'PUT';
    let query = 'tagging';
    if (putOpts && putOpts.versionId) {
      query = `${query}&versionId=${putOpts.versionId}`;
    }
    const tagsList = [];
    for (const [key, value] of Object.entries(tags)) {
      tagsList.push({
        Key: key,
        Value: value
      });
    }
    const taggingConfig = {
      Tagging: {
        TagSet: {
          Tag: tagsList
        }
      }
    };
    const encoder = new _webEncoding.TextEncoder();
    const headers = {};
    const builder = new _xml2js.Builder({
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    let payload = builder.buildObject(taggingConfig);
    payload = Buffer.from(encoder.encode(payload));
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    const requestOptions = {
      method,
      bucketName,
      query,
      headers
    };
    if (objectName) {
      requestOptions['objectName'] = objectName;
    }
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    this.makeRequest(requestOptions, payload, [200], '', false, cb);
  }

  /** Set Tags on a Bucket
   * __Arguments__
   * bucketName _string_
   * tags _object_ of the form {'<tag-key-1>':'<tag-value-1>','<tag-key-2>':'<tag-value-2>'}
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  setBucketTagging(bucketName, tags, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isObject)(tags)) {
      throw new errors.InvalidArgumentError('tags should be of type "object"');
    }
    if (Object.keys(tags).length > 10) {
      throw new errors.InvalidArgumentError('maximum tags allowed is 10"');
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new errors.InvalidArgumentError('callback should be of type "function"');
    }
    return this.setTagging({
      bucketName,
      tags,
      cb
    });
  }

  /** Set Tags on an Object
   * __Arguments__
   * bucketName _string_
   * objectName _string_
   *  * tags _object_ of the form {'<tag-key-1>':'<tag-value-1>','<tag-key-2>':'<tag-value-2>'}
   *  putOpts _object_ (Optional) e.g {versionId:"my-object-version-id"},
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  setObjectTagging(bucketName, objectName, tags, putOpts = {}, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if ((0, _helper.isFunction)(putOpts)) {
      cb = putOpts;
      putOpts = {};
    }
    if (!(0, _helper.isObject)(tags)) {
      throw new errors.InvalidArgumentError('tags should be of type "object"');
    }
    if (Object.keys(tags).length > 10) {
      throw new errors.InvalidArgumentError('Maximum tags allowed is 10"');
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    return this.setTagging({
      bucketName,
      objectName,
      tags,
      putOpts,
      cb
    });
  }

  /** Remove Tags on an Bucket/Object based on params
   * __Arguments__
   * bucketName _string_
   * objectName _string_ (optional)
   * removeOpts _object_ (Optional) e.g {versionId:"my-object-version-id"},
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  removeTagging({
    bucketName,
    objectName,
    removeOpts,
    cb
  }) {
    const method = 'DELETE';
    let query = 'tagging';
    if (removeOpts && Object.keys(removeOpts).length && removeOpts.versionId) {
      query = `${query}&versionId=${removeOpts.versionId}`;
    }
    const requestOptions = {
      method,
      bucketName,
      objectName,
      query
    };
    if (objectName) {
      requestOptions['objectName'] = objectName;
    }
    this.makeRequest(requestOptions, '', [200, 204], '', true, cb);
  }

  /** Remove Tags associated with a bucket
   *  __Arguments__
   * bucketName _string_
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  removeBucketTagging(bucketName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    return this.removeTagging({
      bucketName,
      cb
    });
  }

  /** Remove tags associated with an object
   * __Arguments__
   * bucketName _string_
   * objectName _string_
   * removeOpts _object_ (Optional) e.g. {VersionID:"my-object-version-id"}
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  removeObjectTagging(bucketName, objectName, removeOpts, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if ((0, _helper.isFunction)(removeOpts)) {
      cb = removeOpts;
      removeOpts = {};
    }
    if (removeOpts && Object.keys(removeOpts).length && !(0, _helper.isObject)(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    return this.removeTagging({
      bucketName,
      objectName,
      removeOpts,
      cb
    });
  }

  /** Get Tags associated with a Bucket
   *  __Arguments__
   * bucketName _string_
   * `cb(error, tags)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  getBucketTagging(bucketName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    const method = 'GET';
    const query = 'tagging';
    const requestOptions = {
      method,
      bucketName,
      query
    };
    this.makeRequest(requestOptions, '', [200], '', true, (e, response) => {
      var transformer = transformers.getTagsTransformer();
      if (e) {
        return cb(e);
      }
      let tagsList;
      (0, _helper.pipesetup)(response, transformer).on('data', result => tagsList = result).on('error', e => cb(e)).on('end', () => cb(null, tagsList));
    });
  }

  /** Get the tags associated with a bucket OR an object
   * bucketName _string_
   * objectName _string_ (Optional)
   * getOpts _object_ (Optional) e.g {versionId:"my-object-version-id"}
   * `cb(error, tags)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  getObjectTagging(bucketName, objectName, getOpts = {}, cb = () => false) {
    const method = 'GET';
    let query = 'tagging';
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if ((0, _helper.isFunction)(getOpts)) {
      cb = getOpts;
      getOpts = {};
    }
    if (!(0, _helper.isObject)(getOpts)) {
      throw new errors.InvalidArgumentError('getOpts should be of type "object"');
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    if (getOpts && getOpts.versionId) {
      query = `${query}&versionId=${getOpts.versionId}`;
    }
    const requestOptions = {
      method,
      bucketName,
      query
    };
    if (objectName) {
      requestOptions['objectName'] = objectName;
    }
    this.makeRequest(requestOptions, '', [200], '', true, (e, response) => {
      const transformer = transformers.getTagsTransformer();
      if (e) {
        return cb(e);
      }
      let tagsList;
      (0, _helper.pipesetup)(response, transformer).on('data', result => tagsList = result).on('error', e => cb(e)).on('end', () => cb(null, tagsList));
    });
  }

  /**
   * Apply lifecycle configuration on a bucket.
   * bucketName _string_
   * policyConfig _object_ a valid policy configuration object.
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  applyBucketLifecycle(bucketName, policyConfig, cb) {
    const method = 'PUT';
    const query = 'lifecycle';
    const encoder = new _webEncoding.TextEncoder();
    const headers = {};
    const builder = new _xml2js.Builder({
      rootName: 'LifecycleConfiguration',
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    let payload = builder.buildObject(policyConfig);
    payload = Buffer.from(encoder.encode(payload));
    const requestOptions = {
      method,
      bucketName,
      query,
      headers
    };
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    this.makeRequest(requestOptions, payload, [200], '', false, cb);
  }

  /** Remove lifecycle configuration of a bucket.
   * bucketName _string_
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  removeBucketLifecycle(bucketName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    const query = 'lifecycle';
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [204], '', false, cb);
  }

  /** Set/Override lifecycle configuration on a bucket. if the configuration is empty, it removes the configuration.
   * bucketName _string_
   * lifeCycleConfig _object_ one of the following values: (null or '') to remove the lifecycle configuration. or a valid lifecycle configuration
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  setBucketLifecycle(bucketName, lifeCycleConfig = null, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (_lodash.isEmpty(lifeCycleConfig)) {
      this.removeBucketLifecycle(bucketName, cb);
    } else {
      this.applyBucketLifecycle(bucketName, lifeCycleConfig, cb);
    }
  }

  /** Get lifecycle configuration on a bucket.
   * bucketName _string_
   * `cb(config)` _function_ - callback function with lifecycle configuration as the error argument.
   */
  getBucketLifecycle(bucketName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'lifecycle';
    const requestOptions = {
      method,
      bucketName,
      query
    };
    this.makeRequest(requestOptions, '', [200], '', true, (e, response) => {
      const transformer = transformers.lifecycleTransformer();
      if (e) {
        return cb(e);
      }
      let lifecycleConfig;
      (0, _helper.pipesetup)(response, transformer).on('data', result => lifecycleConfig = result).on('error', e => cb(e)).on('end', () => cb(null, lifecycleConfig));
    });
  }
  setObjectLockConfig(bucketName, lockConfigOpts = {}, cb) {
    const retentionModes = [_type.RETENTION_MODES.COMPLIANCE, _type.RETENTION_MODES.GOVERNANCE];
    const validUnits = [_type.RETENTION_VALIDITY_UNITS.DAYS, _type.RETENTION_VALIDITY_UNITS.YEARS];
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (lockConfigOpts.mode && !retentionModes.includes(lockConfigOpts.mode)) {
      throw new TypeError(`lockConfigOpts.mode should be one of ${retentionModes}`);
    }
    if (lockConfigOpts.unit && !validUnits.includes(lockConfigOpts.unit)) {
      throw new TypeError(`lockConfigOpts.unit should be one of ${validUnits}`);
    }
    if (lockConfigOpts.validity && !(0, _helper.isNumber)(lockConfigOpts.validity)) {
      throw new TypeError(`lockConfigOpts.validity should be a number`);
    }
    const method = 'PUT';
    const query = 'object-lock';
    let config = {
      ObjectLockEnabled: 'Enabled'
    };
    const configKeys = Object.keys(lockConfigOpts);
    // Check if keys are present and all keys are present.
    if (configKeys.length > 0) {
      if (_lodash.difference(configKeys, ['unit', 'mode', 'validity']).length !== 0) {
        throw new TypeError(`lockConfigOpts.mode,lockConfigOpts.unit,lockConfigOpts.validity all the properties should be specified.`);
      } else {
        config.Rule = {
          DefaultRetention: {}
        };
        if (lockConfigOpts.mode) {
          config.Rule.DefaultRetention.Mode = lockConfigOpts.mode;
        }
        if (lockConfigOpts.unit === _type.RETENTION_VALIDITY_UNITS.DAYS) {
          config.Rule.DefaultRetention.Days = lockConfigOpts.validity;
        } else if (lockConfigOpts.unit === _type.RETENTION_VALIDITY_UNITS.YEARS) {
          config.Rule.DefaultRetention.Years = lockConfigOpts.validity;
        }
      }
    }
    const builder = new _xml2js.Builder({
      rootName: 'ObjectLockConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    this.makeRequest({
      method,
      bucketName,
      query,
      headers
    }, payload, [200], '', false, cb);
  }
  getObjectLockConfig(bucketName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new errors.InvalidArgumentError('callback should be of type "function"');
    }
    const method = 'GET';
    const query = 'object-lock';
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      let objectLockConfig = Buffer.from('');
      (0, _helper.pipesetup)(response, transformers.objectLockTransformer()).on('data', data => {
        objectLockConfig = data;
      }).on('error', cb).on('end', () => {
        cb(null, objectLockConfig);
      });
    });
  }
  putObjectRetention(bucketName, objectName, retentionOpts = {}, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(retentionOpts)) {
      throw new errors.InvalidArgumentError('retentionOpts should be of type "object"');
    } else {
      if (retentionOpts.governanceBypass && !(0, _helper.isBoolean)(retentionOpts.governanceBypass)) {
        throw new errors.InvalidArgumentError('Invalid value for governanceBypass', retentionOpts.governanceBypass);
      }
      if (retentionOpts.mode && ![_type.RETENTION_MODES.COMPLIANCE, _type.RETENTION_MODES.GOVERNANCE].includes(retentionOpts.mode)) {
        throw new errors.InvalidArgumentError('Invalid object retention mode ', retentionOpts.mode);
      }
      if (retentionOpts.retainUntilDate && !(0, _helper.isString)(retentionOpts.retainUntilDate)) {
        throw new errors.InvalidArgumentError('Invalid value for retainUntilDate', retentionOpts.retainUntilDate);
      }
      if (retentionOpts.versionId && !(0, _helper.isString)(retentionOpts.versionId)) {
        throw new errors.InvalidArgumentError('Invalid value for versionId', retentionOpts.versionId);
      }
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    const method = 'PUT';
    let query = 'retention';
    const headers = {};
    if (retentionOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    const builder = new _xml2js.Builder({
      rootName: 'Retention',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const params = {};
    if (retentionOpts.mode) {
      params.Mode = retentionOpts.mode;
    }
    if (retentionOpts.retainUntilDate) {
      params.RetainUntilDate = retentionOpts.retainUntilDate;
    }
    if (retentionOpts.versionId) {
      query += `&versionId=${retentionOpts.versionId}`;
    }
    let payload = builder.buildObject(params);
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    this.makeRequest({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload, [200, 204], '', false, cb);
  }
  getObjectRetention(bucketName, objectName, getOpts, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(getOpts)) {
      throw new errors.InvalidArgumentError('callback should be of type "object"');
    } else if (getOpts.versionId && !(0, _helper.isString)(getOpts.versionId)) {
      throw new errors.InvalidArgumentError('VersionID should be of type "string"');
    }
    if (cb && !(0, _helper.isFunction)(cb)) {
      throw new errors.InvalidArgumentError('callback should be of type "function"');
    }
    const method = 'GET';
    let query = 'retention';
    if (getOpts.versionId) {
      query += `&versionId=${getOpts.versionId}`;
    }
    this.makeRequest({
      method,
      bucketName,
      objectName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      let retentionConfig = Buffer.from('');
      (0, _helper.pipesetup)(response, transformers.objectRetentionTransformer()).on('data', data => {
        retentionConfig = data;
      }).on('error', cb).on('end', () => {
        cb(null, retentionConfig);
      });
    });
  }
  setBucketEncryption(bucketName, encryptionConfig, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if ((0, _helper.isFunction)(encryptionConfig)) {
      cb = encryptionConfig;
      encryptionConfig = null;
    }
    if (!_lodash.isEmpty(encryptionConfig) && encryptionConfig.Rule.length > 1) {
      throw new errors.InvalidArgumentError('Invalid Rule length. Only one rule is allowed.: ' + encryptionConfig.Rule);
    }
    if (cb && !(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    let encryptionObj = encryptionConfig;
    if (_lodash.isEmpty(encryptionConfig)) {
      encryptionObj = {
        // Default MinIO Server Supported Rule
        Rule: [{
          ApplyServerSideEncryptionByDefault: {
            SSEAlgorithm: 'AES256'
          }
        }]
      };
    }
    let method = 'PUT';
    let query = 'encryption';
    let builder = new _xml2js.Builder({
      rootName: 'ServerSideEncryptionConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    let payload = builder.buildObject(encryptionObj);
    const headers = {};
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    this.makeRequest({
      method,
      bucketName,
      query,
      headers
    }, payload, [200], '', false, cb);
  }
  getBucketEncryption(bucketName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new errors.InvalidArgumentError('callback should be of type "function"');
    }
    const method = 'GET';
    const query = 'encryption';
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      let bucketEncConfig = Buffer.from('');
      (0, _helper.pipesetup)(response, transformers.bucketEncryptionTransformer()).on('data', data => {
        bucketEncConfig = data;
      }).on('error', cb).on('end', () => {
        cb(null, bucketEncConfig);
      });
    });
  }
  removeBucketEncryption(bucketName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new errors.InvalidArgumentError('callback should be of type "function"');
    }
    const method = 'DELETE';
    const query = 'encryption';
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [204], '', false, cb);
  }
  getObjectLegalHold(bucketName, objectName, getOpts = {}, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if ((0, _helper.isFunction)(getOpts)) {
      cb = getOpts;
      getOpts = {};
    }
    if (!(0, _helper.isObject)(getOpts)) {
      throw new TypeError('getOpts should be of type "Object"');
    } else if (Object.keys(getOpts).length > 0 && getOpts.versionId && !(0, _helper.isString)(getOpts.versionId)) {
      throw new TypeError('versionId should be of type string.:', getOpts.versionId);
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new errors.InvalidArgumentError('callback should be of type "function"');
    }
    const method = 'GET';
    let query = 'legal-hold';
    if (getOpts.versionId) {
      query += `&versionId=${getOpts.versionId}`;
    }
    this.makeRequest({
      method,
      bucketName,
      objectName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      let legalHoldConfig = Buffer.from('');
      (0, _helper.pipesetup)(response, transformers.objectLegalHoldTransformer()).on('data', data => {
        legalHoldConfig = data;
      }).on('error', cb).on('end', () => {
        cb(null, legalHoldConfig);
      });
    });
  }
  setObjectLegalHold(bucketName, objectName, setOpts = {}, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    const defaultOpts = {
      status: _type.LEGAL_HOLD_STATUS.ENABLED
    };
    if ((0, _helper.isFunction)(setOpts)) {
      cb = setOpts;
      setOpts = defaultOpts;
    }
    if (!(0, _helper.isObject)(setOpts)) {
      throw new TypeError('setOpts should be of type "Object"');
    } else {
      if (![_type.LEGAL_HOLD_STATUS.ENABLED, _type.LEGAL_HOLD_STATUS.DISABLED].includes(setOpts.status)) {
        throw new TypeError('Invalid status: ' + setOpts.status);
      }
      if (setOpts.versionId && !setOpts.versionId.length) {
        throw new TypeError('versionId should be of type string.:' + setOpts.versionId);
      }
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new errors.InvalidArgumentError('callback should be of type "function"');
    }
    if (_lodash.isEmpty(setOpts)) {
      setOpts = {
        defaultOpts
      };
    }
    const method = 'PUT';
    let query = 'legal-hold';
    if (setOpts.versionId) {
      query += `&versionId=${setOpts.versionId}`;
    }
    let config = {
      Status: setOpts.status
    };
    const builder = new _xml2js.Builder({
      rootName: 'LegalHold',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    this.makeRequest({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload, [200], '', false, cb);
  }

  /**
   * Internal method to upload a part during compose object.
   * @param partConfig __object__ contains the following.
   *    bucketName __string__
   *    objectName __string__
   *    uploadID __string__
   *    partNumber __number__
   *    headers __object__
   * @param cb called with null incase of error.
   */
  uploadPartCopy(partConfig, cb) {
    const {
      bucketName,
      objectName,
      uploadID,
      partNumber,
      headers
    } = partConfig;
    const method = 'PUT';
    let query = `uploadId=${uploadID}&partNumber=${partNumber}`;
    const requestOptions = {
      method,
      bucketName,
      objectName: objectName,
      query,
      headers
    };
    return this.makeRequest(requestOptions, '', [200], '', true, (e, response) => {
      let partCopyResult = Buffer.from('');
      if (e) {
        return cb(e);
      }
      (0, _helper.pipesetup)(response, transformers.uploadPartTransformer()).on('data', data => {
        partCopyResult = data;
      }).on('error', cb).on('end', () => {
        let uploadPartCopyRes = {
          etag: (0, _helper.sanitizeETag)(partCopyResult.ETag),
          key: objectName,
          part: partNumber
        };
        cb(null, uploadPartCopyRes);
      });
    });
  }
  composeObject(destObjConfig = {}, sourceObjList = [], cb) {
    const me = this; // many async flows. so store the ref.
    const sourceFilesLength = sourceObjList.length;
    if (!Array.isArray(sourceObjList)) {
      throw new errors.InvalidArgumentError('sourceConfig should an array of CopySourceOptions ');
    }
    if (!(destObjConfig instanceof _helpers.CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (sourceFilesLength < 1 || sourceFilesLength > _helper.PART_CONSTRAINTS.MAX_PARTS_COUNT) {
      throw new errors.InvalidArgumentError(`"There must be as least one and up to ${_helper.PART_CONSTRAINTS.MAX_PARTS_COUNT} source objects.`);
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    for (let i = 0; i < sourceFilesLength; i++) {
      if (!sourceObjList[i].validate()) {
        return false;
      }
    }
    if (!destObjConfig.validate()) {
      return false;
    }
    const getStatOptions = srcConfig => {
      let statOpts = {};
      if (!_lodash.isEmpty(srcConfig.VersionID)) {
        statOpts = {
          versionId: srcConfig.VersionID
        };
      }
      return statOpts;
    };
    const srcObjectSizes = [];
    let totalSize = 0;
    let totalParts = 0;
    const sourceObjStats = sourceObjList.map(srcItem => me.statObject(srcItem.Bucket, srcItem.Object, getStatOptions(srcItem)));
    return Promise.all(sourceObjStats).then(srcObjectInfos => {
      const validatedStats = srcObjectInfos.map((resItemStat, index) => {
        const srcConfig = sourceObjList[index];
        let srcCopySize = resItemStat.size;
        // Check if a segment is specified, and if so, is the
        // segment within object bounds?
        if (srcConfig.MatchRange) {
          // Since range is specified,
          //    0 <= src.srcStart <= src.srcEnd
          // so only invalid case to check is:
          const srcStart = srcConfig.Start;
          const srcEnd = srcConfig.End;
          if (srcEnd >= srcCopySize || srcStart < 0) {
            throw new errors.InvalidArgumentError(`CopySrcOptions ${index} has invalid segment-to-copy [${srcStart}, ${srcEnd}] (size is ${srcCopySize})`);
          }
          srcCopySize = srcEnd - srcStart + 1;
        }

        // Only the last source may be less than `absMinPartSize`
        if (srcCopySize < _helper.PART_CONSTRAINTS.ABS_MIN_PART_SIZE && index < sourceFilesLength - 1) {
          throw new errors.InvalidArgumentError(`CopySrcOptions ${index} is too small (${srcCopySize}) and it is not the last part.`);
        }

        // Is data to copy too large?
        totalSize += srcCopySize;
        if (totalSize > _helper.PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE) {
          throw new errors.InvalidArgumentError(`Cannot compose an object of size ${totalSize} (> 5TiB)`);
        }

        // record source size
        srcObjectSizes[index] = srcCopySize;

        // calculate parts needed for current source
        totalParts += (0, _helper.partsRequired)(srcCopySize);
        // Do we need more parts than we are allowed?
        if (totalParts > _helper.PART_CONSTRAINTS.MAX_PARTS_COUNT) {
          throw new errors.InvalidArgumentError(`Your proposed compose object requires more than ${_helper.PART_CONSTRAINTS.MAX_PARTS_COUNT} parts`);
        }
        return resItemStat;
      });
      if (totalParts === 1 && totalSize <= _helper.PART_CONSTRAINTS.MAX_PART_SIZE || totalSize === 0) {
        return this.copyObject(sourceObjList[0], destObjConfig, cb); // use copyObjectV2
      }

      // preserve etag to avoid modification of object while copying.
      for (let i = 0; i < sourceFilesLength; i++) {
        sourceObjList[i].MatchETag = validatedStats[i].etag;
      }
      const splitPartSizeList = validatedStats.map((resItemStat, idx) => {
        const calSize = (0, _helper.calculateEvenSplits)(srcObjectSizes[idx], sourceObjList[idx]);
        return calSize;
      });
      function getUploadPartConfigList(uploadId) {
        const uploadPartConfigList = [];
        splitPartSizeList.forEach((splitSize, splitIndex) => {
          const {
            startIndex: startIdx,
            endIndex: endIdx,
            objInfo: objConfig
          } = splitSize;
          let partIndex = splitIndex + 1; // part index starts from 1.
          const totalUploads = Array.from(startIdx);
          const headers = sourceObjList[splitIndex].getHeaders();
          totalUploads.forEach((splitStart, upldCtrIdx) => {
            let splitEnd = endIdx[upldCtrIdx];
            const sourceObj = `${objConfig.Bucket}/${objConfig.Object}`;
            headers['x-amz-copy-source'] = `${sourceObj}`;
            headers['x-amz-copy-source-range'] = `bytes=${splitStart}-${splitEnd}`;
            const uploadPartConfig = {
              bucketName: destObjConfig.Bucket,
              objectName: destObjConfig.Object,
              uploadID: uploadId,
              partNumber: partIndex,
              headers: headers,
              sourceObj: sourceObj
            };
            uploadPartConfigList.push(uploadPartConfig);
          });
        });
        return uploadPartConfigList;
      }
      const performUploadParts = uploadId => {
        const uploadList = getUploadPartConfigList(uploadId);
        _async.map(uploadList, me.uploadPartCopy.bind(me), (err, res) => {
          if (err) {
            this.abortMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, uploadId).then(() => cb(), err => cb(err));
            return;
          }
          const partsDone = res.map(partCopy => ({
            etag: partCopy.etag,
            part: partCopy.part
          }));
          return me.completeMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, uploadId, partsDone, cb);
        });
      };
      const newUploadHeaders = destObjConfig.getHeaders();
      me.initiateNewMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, newUploadHeaders).then(uploadId => {
        performUploadParts(uploadId);
      }, err => {
        cb(err, null);
      });
    }).catch(error => {
      cb(error, null);
    });
  }
  selectObjectContent(bucketName, objectName, selectOpts = {}, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!_lodash.isEmpty(selectOpts)) {
      if (!(0, _helper.isString)(selectOpts.expression)) {
        throw new TypeError('sqlExpression should be of type "string"');
      }
      if (!_lodash.isEmpty(selectOpts.inputSerialization)) {
        if (!(0, _helper.isObject)(selectOpts.inputSerialization)) {
          throw new TypeError('inputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('inputSerialization is required');
      }
      if (!_lodash.isEmpty(selectOpts.outputSerialization)) {
        if (!(0, _helper.isObject)(selectOpts.outputSerialization)) {
          throw new TypeError('outputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('outputSerialization is required');
      }
    } else {
      throw new TypeError('valid select configuration is required');
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    const method = 'POST';
    let query = `select`;
    query += '&select-type=2';
    const config = [{
      Expression: selectOpts.expression
    }, {
      ExpressionType: selectOpts.expressionType || 'SQL'
    }, {
      InputSerialization: [selectOpts.inputSerialization]
    }, {
      OutputSerialization: [selectOpts.outputSerialization]
    }];

    // Optional
    if (selectOpts.requestProgress) {
      config.push({
        RequestProgress: selectOpts.requestProgress
      });
    }
    // Optional
    if (selectOpts.scanRange) {
      config.push({
        ScanRange: selectOpts.scanRange
      });
    }
    const builder = new _xml2js.Builder({
      rootName: 'SelectObjectContentRequest',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    this.makeRequest({
      method,
      bucketName,
      objectName,
      query
    }, payload, [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      let selectResult;
      (0, _helper.pipesetup)(response, transformers.selectObjectContentTransformer()).on('data', data => {
        selectResult = (0, _xmlParsers.parseSelectObjectContentResponse)(data);
      }).on('error', cb).on('end', () => {
        cb(null, selectResult);
      });
    });
  }
}

// Promisify various public-facing APIs on the Client module.
exports.Client = Client;
Client.prototype.makeBucket = (0, _promisify.promisify)(Client.prototype.makeBucket);
Client.prototype.bucketExists = (0, _promisify.promisify)(Client.prototype.bucketExists);
Client.prototype.getObject = (0, _promisify.promisify)(Client.prototype.getObject);
Client.prototype.getPartialObject = (0, _promisify.promisify)(Client.prototype.getPartialObject);
Client.prototype.fGetObject = (0, _promisify.promisify)(Client.prototype.fGetObject);
Client.prototype.putObject = (0, _promisify.promisify)(Client.prototype.putObject);
Client.prototype.fPutObject = (0, _promisify.promisify)(Client.prototype.fPutObject);
Client.prototype.copyObject = (0, _promisify.promisify)(Client.prototype.copyObject);
Client.prototype.removeObjects = (0, _promisify.promisify)(Client.prototype.removeObjects);
Client.prototype.presignedUrl = (0, _promisify.promisify)(Client.prototype.presignedUrl);
Client.prototype.presignedGetObject = (0, _promisify.promisify)(Client.prototype.presignedGetObject);
Client.prototype.presignedPutObject = (0, _promisify.promisify)(Client.prototype.presignedPutObject);
Client.prototype.presignedPostPolicy = (0, _promisify.promisify)(Client.prototype.presignedPostPolicy);
Client.prototype.getBucketNotification = (0, _promisify.promisify)(Client.prototype.getBucketNotification);
Client.prototype.setBucketNotification = (0, _promisify.promisify)(Client.prototype.setBucketNotification);
Client.prototype.removeAllBucketNotification = (0, _promisify.promisify)(Client.prototype.removeAllBucketNotification);
Client.prototype.getBucketPolicy = (0, _promisify.promisify)(Client.prototype.getBucketPolicy);
Client.prototype.setBucketPolicy = (0, _promisify.promisify)(Client.prototype.setBucketPolicy);
Client.prototype.removeIncompleteUpload = (0, _promisify.promisify)(Client.prototype.removeIncompleteUpload);
Client.prototype.getBucketVersioning = (0, _promisify.promisify)(Client.prototype.getBucketVersioning);
Client.prototype.setBucketVersioning = (0, _promisify.promisify)(Client.prototype.setBucketVersioning);
Client.prototype.setBucketTagging = (0, _promisify.promisify)(Client.prototype.setBucketTagging);
Client.prototype.removeBucketTagging = (0, _promisify.promisify)(Client.prototype.removeBucketTagging);
Client.prototype.getBucketTagging = (0, _promisify.promisify)(Client.prototype.getBucketTagging);
Client.prototype.setObjectTagging = (0, _promisify.promisify)(Client.prototype.setObjectTagging);
Client.prototype.removeObjectTagging = (0, _promisify.promisify)(Client.prototype.removeObjectTagging);
Client.prototype.getObjectTagging = (0, _promisify.promisify)(Client.prototype.getObjectTagging);
Client.prototype.setBucketLifecycle = (0, _promisify.promisify)(Client.prototype.setBucketLifecycle);
Client.prototype.getBucketLifecycle = (0, _promisify.promisify)(Client.prototype.getBucketLifecycle);
Client.prototype.removeBucketLifecycle = (0, _promisify.promisify)(Client.prototype.removeBucketLifecycle);
Client.prototype.setObjectLockConfig = (0, _promisify.promisify)(Client.prototype.setObjectLockConfig);
Client.prototype.getObjectLockConfig = (0, _promisify.promisify)(Client.prototype.getObjectLockConfig);
Client.prototype.putObjectRetention = (0, _promisify.promisify)(Client.prototype.putObjectRetention);
Client.prototype.getObjectRetention = (0, _promisify.promisify)(Client.prototype.getObjectRetention);
Client.prototype.setBucketEncryption = (0, _promisify.promisify)(Client.prototype.setBucketEncryption);
Client.prototype.getBucketEncryption = (0, _promisify.promisify)(Client.prototype.getBucketEncryption);
Client.prototype.removeBucketEncryption = (0, _promisify.promisify)(Client.prototype.removeBucketEncryption);
Client.prototype.setObjectLegalHold = (0, _promisify.promisify)(Client.prototype.setObjectLegalHold);
Client.prototype.getObjectLegalHold = (0, _promisify.promisify)(Client.prototype.getObjectLegalHold);
Client.prototype.composeObject = (0, _promisify.promisify)(Client.prototype.composeObject);
Client.prototype.selectObjectContent = (0, _promisify.promisify)(Client.prototype.selectObjectContent);

// refactored API use promise internally
Client.prototype.removeObject = (0, _callbackify.callbackify)(Client.prototype.removeObject);
Client.prototype.statObject = (0, _callbackify.callbackify)(Client.prototype.statObject);
Client.prototype.removeBucket = (0, _callbackify.callbackify)(Client.prototype.removeBucket);
Client.prototype.listBuckets = (0, _callbackify.callbackify)(Client.prototype.listBuckets);
Client.prototype.removeBucketReplication = (0, _callbackify.callbackify)(Client.prototype.removeBucketReplication);
Client.prototype.setBucketReplication = (0, _callbackify.callbackify)(Client.prototype.setBucketReplication);
Client.prototype.getBucketReplication = (0, _callbackify.callbackify)(Client.prototype.getBucketReplication);
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmcyIsIl9pbnRlcm9wUmVxdWlyZVdpbGRjYXJkIiwicmVxdWlyZSIsInBhdGgiLCJTdHJlYW0iLCJfYXN5bmMiLCJfYmxvY2tTdHJlYW0iLCJfbG9kYXNoIiwicXVlcnlzdHJpbmciLCJfd2ViRW5jb2RpbmciLCJfeG1sIiwiX3htbDJqcyIsImVycm9ycyIsIl9oZWxwZXJzIiwiT2JqZWN0Iiwia2V5cyIsImZvckVhY2giLCJrZXkiLCJwcm90b3R5cGUiLCJoYXNPd25Qcm9wZXJ0eSIsImNhbGwiLCJfZXhwb3J0TmFtZXMiLCJleHBvcnRzIiwiX2NhbGxiYWNraWZ5IiwiX2NsaWVudCIsIl9jb3B5Q29uZGl0aW9ucyIsIkNvcHlDb25kaXRpb25zIiwiX2hlbHBlciIsIl9wb3N0UG9saWN5IiwiUG9zdFBvbGljeSIsIl90eXBlIiwiX25vdGlmaWNhdGlvbiIsIl9vYmplY3RVcGxvYWRlciIsIl9wcm9taXNpZnkiLCJfc2lnbmluZyIsInRyYW5zZm9ybWVycyIsIl94bWxQYXJzZXJzIiwiX2dldFJlcXVpcmVXaWxkY2FyZENhY2hlIiwibm9kZUludGVyb3AiLCJXZWFrTWFwIiwiY2FjaGVCYWJlbEludGVyb3AiLCJjYWNoZU5vZGVJbnRlcm9wIiwib2JqIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJjYWNoZSIsImhhcyIsImdldCIsIm5ld09iaiIsImhhc1Byb3BlcnR5RGVzY3JpcHRvciIsImRlZmluZVByb3BlcnR5IiwiZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yIiwiZGVzYyIsInNldCIsIkNsaWVudCIsIlR5cGVkQ2xpZW50Iiwic2V0QXBwSW5mbyIsImFwcE5hbWUiLCJhcHBWZXJzaW9uIiwiaXNTdHJpbmciLCJUeXBlRXJyb3IiLCJ0cmltIiwiSW52YWxpZEFyZ3VtZW50RXJyb3IiLCJ1c2VyQWdlbnQiLCJjYWxjdWxhdGVQYXJ0U2l6ZSIsInNpemUiLCJpc051bWJlciIsIm1heE9iamVjdFNpemUiLCJvdmVyUmlkZVBhcnRTaXplIiwicGFydFNpemUiLCJtYWtlQnVja2V0IiwiYnVja2V0TmFtZSIsInJlZ2lvbiIsIm1ha2VPcHRzIiwiY2IiLCJpc1ZhbGlkQnVja2V0TmFtZSIsIkludmFsaWRCdWNrZXROYW1lRXJyb3IiLCJpc09iamVjdCIsImlzRnVuY3Rpb24iLCJwYXlsb2FkIiwiREVGQVVMVF9SRUdJT04iLCJjcmVhdGVCdWNrZXRDb25maWd1cmF0aW9uIiwicHVzaCIsIl9hdHRyIiwieG1sbnMiLCJMb2NhdGlvbkNvbnN0cmFpbnQiLCJwYXlsb2FkT2JqZWN0IiwiQ3JlYXRlQnVja2V0Q29uZmlndXJhdGlvbiIsIlhtbCIsIm1ldGhvZCIsImhlYWRlcnMiLCJPYmplY3RMb2NraW5nIiwicHJvY2Vzc1dpdGhSZXRyeSIsImVyciIsImNvZGUiLCJtYWtlUmVxdWVzdCIsImxpc3RJbmNvbXBsZXRlVXBsb2FkcyIsImJ1Y2tldCIsInByZWZpeCIsInJlY3Vyc2l2ZSIsInVuZGVmaW5lZCIsImlzVmFsaWRQcmVmaXgiLCJJbnZhbGlkUHJlZml4RXJyb3IiLCJpc0Jvb2xlYW4iLCJkZWxpbWl0ZXIiLCJrZXlNYXJrZXIiLCJ1cGxvYWRJZE1hcmtlciIsInVwbG9hZHMiLCJlbmRlZCIsInJlYWRTdHJlYW0iLCJSZWFkYWJsZSIsIm9iamVjdE1vZGUiLCJfcmVhZCIsImxlbmd0aCIsInNoaWZ0IiwibGlzdEluY29tcGxldGVVcGxvYWRzUXVlcnkiLCJvbiIsImUiLCJlbWl0IiwicmVzdWx0IiwicHJlZml4ZXMiLCJhc3luYyIsImVhY2hTZXJpZXMiLCJ1cGxvYWQiLCJsaXN0UGFydHMiLCJ1cGxvYWRJZCIsInRoZW4iLCJwYXJ0cyIsInJlZHVjZSIsImFjYyIsIml0ZW0iLCJpc1RydW5jYXRlZCIsIm5leHRLZXlNYXJrZXIiLCJuZXh0VXBsb2FkSWRNYXJrZXIiLCJidWNrZXRFeGlzdHMiLCJyZW1vdmVJbmNvbXBsZXRlVXBsb2FkIiwib2JqZWN0TmFtZSIsIklzVmFsaWRCdWNrZXROYW1lRXJyb3IiLCJpc1ZhbGlkT2JqZWN0TmFtZSIsIkludmFsaWRPYmplY3ROYW1lRXJyb3IiLCJyZW1vdmVVcGxvYWRJZCIsImR1cmluZyIsImZpbmRVcGxvYWRJZCIsInF1ZXJ5IiwiZkdldE9iamVjdCIsImZpbGVQYXRoIiwiZ2V0T3B0cyIsInBhcnRGaWxlIiwicGFydEZpbGVTdHJlYW0iLCJvYmpTdGF0IiwicmVuYW1lIiwid2F0ZXJmYWxsIiwic3RhdE9iamVjdCIsIm1rZGlyIiwiZGlybmFtZSIsImV0YWciLCJzdGF0Iiwic3RhdHMiLCJvZmZzZXQiLCJjcmVhdGVXcml0ZVN0cmVhbSIsImZsYWdzIiwiZ2V0UGFydGlhbE9iamVjdCIsImRvd25sb2FkU3RyZWFtIiwicGlwZXNldHVwIiwiRXJyb3IiLCJnZXRPYmplY3QiLCJyYW5nZSIsImV4cGVjdGVkU3RhdHVzQ29kZXMiLCJzdHJpbmdpZnkiLCJmUHV0T2JqZWN0IiwibWV0YURhdGEiLCJjYWxsYmFjayIsImluc2VydENvbnRlbnRUeXBlIiwibHN0YXQiLCJwdXRPYmplY3QiLCJjcmVhdGVSZWFkU3RyZWFtIiwic3RyZWFtIiwicHJlcGVuZFhBTVpNZXRhIiwiQnVmZmVyIiwicmVhZGFibGVTdHJlYW0iLCJpc1JlYWRhYmxlU3RyZWFtIiwiY2h1bmtlciIsIkJsb2NrU3RyZWFtMiIsInplcm9QYWRkaW5nIiwidXBsb2FkZXIiLCJPYmplY3RVcGxvYWRlciIsImNvcHlPYmplY3RWMSIsImFyZzEiLCJhcmcyIiwiYXJnMyIsImFyZzQiLCJhcmc1Iiwic3JjT2JqZWN0IiwiY29uZGl0aW9ucyIsInVyaVJlc291cmNlRXNjYXBlIiwibW9kaWZpZWQiLCJ1bm1vZGlmaWVkIiwibWF0Y2hFVGFnIiwibWF0Y2hFdGFnRXhjZXB0IiwibWF0Y2hFVGFnRXhjZXB0IiwicmVzcG9uc2UiLCJ0cmFuc2Zvcm1lciIsImdldENvcHlPYmplY3RUcmFuc2Zvcm1lciIsImRhdGEiLCJjb3B5T2JqZWN0VjIiLCJzb3VyY2VDb25maWciLCJkZXN0Q29uZmlnIiwiQ29weVNvdXJjZU9wdGlvbnMiLCJDb3B5RGVzdGluYXRpb25PcHRpb25zIiwidmFsaWRhdGUiLCJhc3NpZ24iLCJnZXRIZWFkZXJzIiwiQnVja2V0IiwicmVzSGVhZGVycyIsImNvcHlPYmpSZXNwb25zZSIsIktleSIsIkxhc3RNb2RpZmllZCIsIk1ldGFEYXRhIiwiZXh0cmFjdE1ldGFkYXRhIiwiVmVyc2lvbklkIiwiZ2V0VmVyc2lvbklkIiwiU291cmNlVmVyc2lvbklkIiwiZ2V0U291cmNlVmVyc2lvbklkIiwiRXRhZyIsInNhbml0aXplRVRhZyIsIlNpemUiLCJjb3B5T2JqZWN0IiwiYWxsQXJncyIsImFyZ3VtZW50cyIsImxpc3RPYmplY3RzUXVlcnkiLCJtYXJrZXIiLCJsaXN0UXVlcnlPcHRzIiwiRGVsaW1pdGVyIiwiTWF4S2V5cyIsIkluY2x1ZGVWZXJzaW9uIiwicXVlcmllcyIsInVyaUVzY2FwZSIsInNvcnQiLCJqb2luIiwiZ2V0TGlzdE9iamVjdHNUcmFuc2Zvcm1lciIsImxpc3RPYmplY3RzIiwibGlzdE9wdHMiLCJvYmplY3RzIiwibmV4dE1hcmtlciIsInZlcnNpb25JZE1hcmtlciIsImxpc3RPYmplY3RzVjJRdWVyeSIsImNvbnRpbnVhdGlvblRva2VuIiwibWF4S2V5cyIsInN0YXJ0QWZ0ZXIiLCJnZXRMaXN0T2JqZWN0c1YyVHJhbnNmb3JtZXIiLCJsaXN0T2JqZWN0c1YyIiwibmV4dENvbnRpbnVhdGlvblRva2VuIiwicmVtb3ZlT2JqZWN0cyIsIm9iamVjdHNMaXN0IiwiQXJyYXkiLCJpc0FycmF5IiwibWF4RW50cmllcyIsImVudHJ5IiwibGlzdCIsImxpc3RPZkxpc3QiLCJlbmNvZGVyIiwiVGV4dEVuY29kZXIiLCJiYXRjaFJlc3VsdHMiLCJiYXRjaENiIiwidmFsdWUiLCJuYW1lIiwidmVyc2lvbklkIiwiZGVsZXRlT2JqZWN0cyIsIkRlbGV0ZSIsIlF1aWV0IiwiYnVpbGRlciIsInhtbDJqcyIsIkJ1aWxkZXIiLCJoZWFkbGVzcyIsImJ1aWxkT2JqZWN0IiwiZnJvbSIsImVuY29kZSIsInRvTWQ1IiwicmVtb3ZlT2JqZWN0c1Jlc3VsdCIsInJlbW92ZU9iamVjdHNUcmFuc2Zvcm1lciIsIl8iLCJmbGF0dGVuIiwiZ2V0QnVja2V0UG9saWN5IiwicG9saWN5IiwiZ2V0Q29uY2F0ZXIiLCJ0b1N0cmluZyIsInNldEJ1Y2tldFBvbGljeSIsIkludmFsaWRCdWNrZXRQb2xpY3lFcnJvciIsInByZXNpZ25lZFVybCIsImV4cGlyZXMiLCJyZXFQYXJhbXMiLCJyZXF1ZXN0RGF0ZSIsImFub255bW91cyIsIkFub255bW91c1JlcXVlc3RFcnJvciIsIkRhdGUiLCJpc1ZhbGlkRGF0ZSIsImdldEJ1Y2tldFJlZ2lvbiIsInVybCIsInJlcU9wdGlvbnMiLCJnZXRSZXF1ZXN0T3B0aW9ucyIsImNoZWNrQW5kUmVmcmVzaENyZWRzIiwicHJlc2lnblNpZ25hdHVyZVY0IiwiYWNjZXNzS2V5Iiwic2VjcmV0S2V5Iiwic2Vzc2lvblRva2VuIiwicGUiLCJwcmVzaWduZWRHZXRPYmplY3QiLCJyZXNwSGVhZGVycyIsInZhbGlkUmVzcEhlYWRlcnMiLCJoZWFkZXIiLCJwcmVzaWduZWRQdXRPYmplY3QiLCJuZXdQb3N0UG9saWN5IiwicHJlc2lnbmVkUG9zdFBvbGljeSIsInBvc3RQb2xpY3kiLCJmb3JtRGF0YSIsImRhdGUiLCJkYXRlU3RyIiwibWFrZURhdGVMb25nIiwiZXhwaXJhdGlvbiIsInNldFNlY29uZHMiLCJzZXRFeHBpcmVzIiwiZ2V0U2NvcGUiLCJwb2xpY3lCYXNlNjQiLCJKU09OIiwic2lnbmF0dXJlIiwicG9zdFByZXNpZ25TaWduYXR1cmVWNCIsIm9wdHMiLCJwb3J0U3RyIiwicG9ydCIsInVybFN0ciIsInByb3RvY29sIiwiaG9zdCIsInBvc3RVUkwiLCJjb21wbGV0ZU11bHRpcGFydFVwbG9hZCIsImV0YWdzIiwiZWxlbWVudCIsIlBhcnQiLCJQYXJ0TnVtYmVyIiwicGFydCIsIkVUYWciLCJDb21wbGV0ZU11bHRpcGFydFVwbG9hZCIsImdldENvbXBsZXRlTXVsdGlwYXJ0VHJhbnNmb3JtZXIiLCJlcnJDb2RlIiwiUzNFcnJvciIsImVyck1lc3NhZ2UiLCJjb21wbGV0ZU11bHRpcGFydFJlc3VsdCIsIm1heFVwbG9hZHMiLCJ1bnNoaWZ0IiwiZ2V0TGlzdE11bHRpcGFydFRyYW5zZm9ybWVyIiwibGF0ZXN0VXBsb2FkIiwibGlzdE5leHQiLCJpbml0aWF0ZWQiLCJnZXRUaW1lIiwic2V0QnVja2V0Tm90aWZpY2F0aW9uIiwiY29uZmlnIiwicm9vdE5hbWUiLCJyZW5kZXJPcHRzIiwicHJldHR5IiwicmVtb3ZlQWxsQnVja2V0Tm90aWZpY2F0aW9uIiwiTm90aWZpY2F0aW9uQ29uZmlnIiwiZ2V0QnVja2V0Tm90aWZpY2F0aW9uIiwiZ2V0QnVja2V0Tm90aWZpY2F0aW9uVHJhbnNmb3JtZXIiLCJidWNrZXROb3RpZmljYXRpb24iLCJsaXN0ZW5CdWNrZXROb3RpZmljYXRpb24iLCJzdWZmaXgiLCJldmVudHMiLCJsaXN0ZW5lciIsIk5vdGlmaWNhdGlvblBvbGxlciIsInN0YXJ0IiwiZ2V0QnVja2V0VmVyc2lvbmluZyIsInZlcnNpb25Db25maWciLCJidWNrZXRWZXJzaW9uaW5nVHJhbnNmb3JtZXIiLCJzZXRCdWNrZXRWZXJzaW9uaW5nIiwic2V0VGFnZ2luZyIsInRhZ2dpbmdQYXJhbXMiLCJ0YWdzIiwicHV0T3B0cyIsInRhZ3NMaXN0IiwiZW50cmllcyIsIlZhbHVlIiwidGFnZ2luZ0NvbmZpZyIsIlRhZ2dpbmciLCJUYWdTZXQiLCJUYWciLCJyZXF1ZXN0T3B0aW9ucyIsInNldEJ1Y2tldFRhZ2dpbmciLCJzZXRPYmplY3RUYWdnaW5nIiwicmVtb3ZlVGFnZ2luZyIsInJlbW92ZU9wdHMiLCJyZW1vdmVCdWNrZXRUYWdnaW5nIiwicmVtb3ZlT2JqZWN0VGFnZ2luZyIsImdldEJ1Y2tldFRhZ2dpbmciLCJnZXRUYWdzVHJhbnNmb3JtZXIiLCJnZXRPYmplY3RUYWdnaW5nIiwiYXBwbHlCdWNrZXRMaWZlY3ljbGUiLCJwb2xpY3lDb25maWciLCJyZW1vdmVCdWNrZXRMaWZlY3ljbGUiLCJzZXRCdWNrZXRMaWZlY3ljbGUiLCJsaWZlQ3ljbGVDb25maWciLCJpc0VtcHR5IiwiZ2V0QnVja2V0TGlmZWN5Y2xlIiwibGlmZWN5Y2xlVHJhbnNmb3JtZXIiLCJsaWZlY3ljbGVDb25maWciLCJzZXRPYmplY3RMb2NrQ29uZmlnIiwibG9ja0NvbmZpZ09wdHMiLCJyZXRlbnRpb25Nb2RlcyIsIlJFVEVOVElPTl9NT0RFUyIsIkNPTVBMSUFOQ0UiLCJHT1ZFUk5BTkNFIiwidmFsaWRVbml0cyIsIlJFVEVOVElPTl9WQUxJRElUWV9VTklUUyIsIkRBWVMiLCJZRUFSUyIsIm1vZGUiLCJpbmNsdWRlcyIsInVuaXQiLCJ2YWxpZGl0eSIsIk9iamVjdExvY2tFbmFibGVkIiwiY29uZmlnS2V5cyIsImRpZmZlcmVuY2UiLCJSdWxlIiwiRGVmYXVsdFJldGVudGlvbiIsIk1vZGUiLCJEYXlzIiwiWWVhcnMiLCJnZXRPYmplY3RMb2NrQ29uZmlnIiwib2JqZWN0TG9ja0NvbmZpZyIsIm9iamVjdExvY2tUcmFuc2Zvcm1lciIsInB1dE9iamVjdFJldGVudGlvbiIsInJldGVudGlvbk9wdHMiLCJnb3Zlcm5hbmNlQnlwYXNzIiwicmV0YWluVW50aWxEYXRlIiwicGFyYW1zIiwiUmV0YWluVW50aWxEYXRlIiwiZ2V0T2JqZWN0UmV0ZW50aW9uIiwicmV0ZW50aW9uQ29uZmlnIiwib2JqZWN0UmV0ZW50aW9uVHJhbnNmb3JtZXIiLCJzZXRCdWNrZXRFbmNyeXB0aW9uIiwiZW5jcnlwdGlvbkNvbmZpZyIsImVuY3J5cHRpb25PYmoiLCJBcHBseVNlcnZlclNpZGVFbmNyeXB0aW9uQnlEZWZhdWx0IiwiU1NFQWxnb3JpdGhtIiwiZ2V0QnVja2V0RW5jcnlwdGlvbiIsImJ1Y2tldEVuY0NvbmZpZyIsImJ1Y2tldEVuY3J5cHRpb25UcmFuc2Zvcm1lciIsInJlbW92ZUJ1Y2tldEVuY3J5cHRpb24iLCJnZXRPYmplY3RMZWdhbEhvbGQiLCJsZWdhbEhvbGRDb25maWciLCJvYmplY3RMZWdhbEhvbGRUcmFuc2Zvcm1lciIsInNldE9iamVjdExlZ2FsSG9sZCIsInNldE9wdHMiLCJkZWZhdWx0T3B0cyIsInN0YXR1cyIsIkxFR0FMX0hPTERfU1RBVFVTIiwiRU5BQkxFRCIsIkRJU0FCTEVEIiwiU3RhdHVzIiwidXBsb2FkUGFydENvcHkiLCJwYXJ0Q29uZmlnIiwidXBsb2FkSUQiLCJwYXJ0TnVtYmVyIiwicGFydENvcHlSZXN1bHQiLCJ1cGxvYWRQYXJ0VHJhbnNmb3JtZXIiLCJ1cGxvYWRQYXJ0Q29weVJlcyIsImNvbXBvc2VPYmplY3QiLCJkZXN0T2JqQ29uZmlnIiwic291cmNlT2JqTGlzdCIsIm1lIiwic291cmNlRmlsZXNMZW5ndGgiLCJQQVJUX0NPTlNUUkFJTlRTIiwiTUFYX1BBUlRTX0NPVU5UIiwiaSIsImdldFN0YXRPcHRpb25zIiwic3JjQ29uZmlnIiwic3RhdE9wdHMiLCJWZXJzaW9uSUQiLCJzcmNPYmplY3RTaXplcyIsInRvdGFsU2l6ZSIsInRvdGFsUGFydHMiLCJzb3VyY2VPYmpTdGF0cyIsIm1hcCIsInNyY0l0ZW0iLCJQcm9taXNlIiwiYWxsIiwic3JjT2JqZWN0SW5mb3MiLCJ2YWxpZGF0ZWRTdGF0cyIsInJlc0l0ZW1TdGF0IiwiaW5kZXgiLCJzcmNDb3B5U2l6ZSIsIk1hdGNoUmFuZ2UiLCJzcmNTdGFydCIsIlN0YXJ0Iiwic3JjRW5kIiwiRW5kIiwiQUJTX01JTl9QQVJUX1NJWkUiLCJNQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSIsInBhcnRzUmVxdWlyZWQiLCJNQVhfUEFSVF9TSVpFIiwiTWF0Y2hFVGFnIiwic3BsaXRQYXJ0U2l6ZUxpc3QiLCJpZHgiLCJjYWxTaXplIiwiY2FsY3VsYXRlRXZlblNwbGl0cyIsImdldFVwbG9hZFBhcnRDb25maWdMaXN0IiwidXBsb2FkUGFydENvbmZpZ0xpc3QiLCJzcGxpdFNpemUiLCJzcGxpdEluZGV4Iiwic3RhcnRJbmRleCIsInN0YXJ0SWR4IiwiZW5kSW5kZXgiLCJlbmRJZHgiLCJvYmpJbmZvIiwib2JqQ29uZmlnIiwicGFydEluZGV4IiwidG90YWxVcGxvYWRzIiwic3BsaXRTdGFydCIsInVwbGRDdHJJZHgiLCJzcGxpdEVuZCIsInNvdXJjZU9iaiIsInVwbG9hZFBhcnRDb25maWciLCJwZXJmb3JtVXBsb2FkUGFydHMiLCJ1cGxvYWRMaXN0IiwiYmluZCIsInJlcyIsImFib3J0TXVsdGlwYXJ0VXBsb2FkIiwicGFydHNEb25lIiwicGFydENvcHkiLCJuZXdVcGxvYWRIZWFkZXJzIiwiaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQiLCJjYXRjaCIsImVycm9yIiwic2VsZWN0T2JqZWN0Q29udGVudCIsInNlbGVjdE9wdHMiLCJleHByZXNzaW9uIiwiaW5wdXRTZXJpYWxpemF0aW9uIiwib3V0cHV0U2VyaWFsaXphdGlvbiIsIkV4cHJlc3Npb24iLCJFeHByZXNzaW9uVHlwZSIsImV4cHJlc3Npb25UeXBlIiwiSW5wdXRTZXJpYWxpemF0aW9uIiwiT3V0cHV0U2VyaWFsaXphdGlvbiIsInJlcXVlc3RQcm9ncmVzcyIsIlJlcXVlc3RQcm9ncmVzcyIsInNjYW5SYW5nZSIsIlNjYW5SYW5nZSIsInNlbGVjdFJlc3VsdCIsInNlbGVjdE9iamVjdENvbnRlbnRUcmFuc2Zvcm1lciIsInBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlIiwicHJvbWlzaWZ5IiwicmVtb3ZlT2JqZWN0IiwiY2FsbGJhY2tpZnkiLCJyZW1vdmVCdWNrZXQiLCJsaXN0QnVja2V0cyIsInJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uIiwic2V0QnVja2V0UmVwbGljYXRpb24iLCJnZXRCdWNrZXRSZXBsaWNhdGlvbiJdLCJzb3VyY2VzIjpbIm1pbmlvLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gKiBNaW5JTyBKYXZhc2NyaXB0IExpYnJhcnkgZm9yIEFtYXpvbiBTMyBDb21wYXRpYmxlIENsb3VkIFN0b3JhZ2UsIChDKSAyMDE1IE1pbklPLCBJbmMuXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICovXG5cbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCAqIGFzIFN0cmVhbSBmcm9tICdub2RlOnN0cmVhbSdcblxuaW1wb3J0IGFzeW5jIGZyb20gJ2FzeW5jJ1xuaW1wb3J0IEJsb2NrU3RyZWFtMiBmcm9tICdibG9jay1zdHJlYW0yJ1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJ1xuaW1wb3J0ICogYXMgcXVlcnlzdHJpbmcgZnJvbSAncXVlcnktc3RyaW5nJ1xuaW1wb3J0IHsgVGV4dEVuY29kZXIgfSBmcm9tICd3ZWItZW5jb2RpbmcnXG5pbXBvcnQgWG1sIGZyb20gJ3htbCdcbmltcG9ydCB4bWwyanMgZnJvbSAneG1sMmpzJ1xuXG5pbXBvcnQgKiBhcyBlcnJvcnMgZnJvbSAnLi9lcnJvcnMudHMnXG5pbXBvcnQgeyBDb3B5RGVzdGluYXRpb25PcHRpb25zLCBDb3B5U291cmNlT3B0aW9ucywgREVGQVVMVF9SRUdJT04gfSBmcm9tICcuL2hlbHBlcnMudHMnXG5pbXBvcnQgeyBjYWxsYmFja2lmeSB9IGZyb20gJy4vaW50ZXJuYWwvY2FsbGJhY2tpZnkuanMnXG5pbXBvcnQgeyBUeXBlZENsaWVudCB9IGZyb20gJy4vaW50ZXJuYWwvY2xpZW50LnRzJ1xuaW1wb3J0IHsgQ29weUNvbmRpdGlvbnMgfSBmcm9tICcuL2ludGVybmFsL2NvcHktY29uZGl0aW9ucy50cydcbmltcG9ydCB7XG4gIGNhbGN1bGF0ZUV2ZW5TcGxpdHMsXG4gIGV4dHJhY3RNZXRhZGF0YSxcbiAgZ2V0U2NvcGUsXG4gIGdldFNvdXJjZVZlcnNpb25JZCxcbiAgZ2V0VmVyc2lvbklkLFxuICBpbnNlcnRDb250ZW50VHlwZSxcbiAgaXNCb29sZWFuLFxuICBpc0Z1bmN0aW9uLFxuICBpc051bWJlcixcbiAgaXNPYmplY3QsXG4gIGlzUmVhZGFibGVTdHJlYW0sXG4gIGlzU3RyaW5nLFxuICBpc1ZhbGlkQnVja2V0TmFtZSxcbiAgaXNWYWxpZERhdGUsXG4gIGlzVmFsaWRPYmplY3ROYW1lLFxuICBpc1ZhbGlkUHJlZml4LFxuICBtYWtlRGF0ZUxvbmcsXG4gIFBBUlRfQ09OU1RSQUlOVFMsXG4gIHBhcnRzUmVxdWlyZWQsXG4gIHBpcGVzZXR1cCxcbiAgcHJlcGVuZFhBTVpNZXRhLFxuICByZWFkYWJsZVN0cmVhbSxcbiAgc2FuaXRpemVFVGFnLFxuICB0b01kNSxcbiAgdXJpRXNjYXBlLFxuICB1cmlSZXNvdXJjZUVzY2FwZSxcbn0gZnJvbSAnLi9pbnRlcm5hbC9oZWxwZXIudHMnXG5pbXBvcnQgeyBQb3N0UG9saWN5IH0gZnJvbSAnLi9pbnRlcm5hbC9wb3N0LXBvbGljeS50cydcbmltcG9ydCB7IExFR0FMX0hPTERfU1RBVFVTLCBSRVRFTlRJT05fTU9ERVMsIFJFVEVOVElPTl9WQUxJRElUWV9VTklUUyB9IGZyb20gJy4vaW50ZXJuYWwvdHlwZS50cydcbmltcG9ydCB7IE5vdGlmaWNhdGlvbkNvbmZpZywgTm90aWZpY2F0aW9uUG9sbGVyIH0gZnJvbSAnLi9ub3RpZmljYXRpb24uanMnXG5pbXBvcnQgeyBPYmplY3RVcGxvYWRlciB9IGZyb20gJy4vb2JqZWN0LXVwbG9hZGVyLmpzJ1xuaW1wb3J0IHsgcHJvbWlzaWZ5IH0gZnJvbSAnLi9wcm9taXNpZnkuanMnXG5pbXBvcnQgeyBwb3N0UHJlc2lnblNpZ25hdHVyZVY0LCBwcmVzaWduU2lnbmF0dXJlVjQgfSBmcm9tICcuL3NpZ25pbmcudHMnXG5pbXBvcnQgKiBhcyB0cmFuc2Zvcm1lcnMgZnJvbSAnLi90cmFuc2Zvcm1lcnMuanMnXG5pbXBvcnQgeyBwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZSB9IGZyb20gJy4veG1sLXBhcnNlcnMuanMnXG5cbmV4cG9ydCAqIGZyb20gJy4vaGVscGVycy50cydcbmV4cG9ydCAqIGZyb20gJy4vbm90aWZpY2F0aW9uLmpzJ1xuZXhwb3J0IHsgQ29weUNvbmRpdGlvbnMsIFBvc3RQb2xpY3kgfVxuXG5leHBvcnQgY2xhc3MgQ2xpZW50IGV4dGVuZHMgVHlwZWRDbGllbnQge1xuICAvLyBTZXQgYXBwbGljYXRpb24gc3BlY2lmaWMgaW5mb3JtYXRpb24uXG4gIC8vXG4gIC8vIEdlbmVyYXRlcyBVc2VyLUFnZW50IGluIHRoZSBmb2xsb3dpbmcgc3R5bGUuXG4gIC8vXG4gIC8vICAgICAgIE1pbklPIChPUzsgQVJDSCkgTElCL1ZFUiBBUFAvVkVSXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYXBwTmFtZWAgX3N0cmluZ18gLSBBcHBsaWNhdGlvbiBuYW1lLlxuICAvLyAqIGBhcHBWZXJzaW9uYCBfc3RyaW5nXyAtIEFwcGxpY2F0aW9uIHZlcnNpb24uXG4gIHNldEFwcEluZm8oYXBwTmFtZSwgYXBwVmVyc2lvbikge1xuICAgIGlmICghaXNTdHJpbmcoYXBwTmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEludmFsaWQgYXBwTmFtZTogJHthcHBOYW1lfWApXG4gICAgfVxuICAgIGlmIChhcHBOYW1lLnRyaW0oKSA9PT0gJycpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0lucHV0IGFwcE5hbWUgY2Fubm90IGJlIGVtcHR5LicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoYXBwVmVyc2lvbikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEludmFsaWQgYXBwVmVyc2lvbjogJHthcHBWZXJzaW9ufWApXG4gICAgfVxuICAgIGlmIChhcHBWZXJzaW9uLnRyaW0oKSA9PT0gJycpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0lucHV0IGFwcFZlcnNpb24gY2Fubm90IGJlIGVtcHR5LicpXG4gICAgfVxuICAgIHRoaXMudXNlckFnZW50ID0gYCR7dGhpcy51c2VyQWdlbnR9ICR7YXBwTmFtZX0vJHthcHBWZXJzaW9ufWBcbiAgfVxuXG4gIC8vIENhbGN1bGF0ZSBwYXJ0IHNpemUgZ2l2ZW4gdGhlIG9iamVjdCBzaXplLiBQYXJ0IHNpemUgd2lsbCBiZSBhdGxlYXN0IHRoaXMucGFydFNpemVcbiAgY2FsY3VsYXRlUGFydFNpemUoc2l6ZSkge1xuICAgIGlmICghaXNOdW1iZXIoc2l6ZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NpemUgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuICAgIGlmIChzaXplID4gdGhpcy5tYXhPYmplY3RTaXplKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBzaXplIHNob3VsZCBub3QgYmUgbW9yZSB0aGFuICR7dGhpcy5tYXhPYmplY3RTaXplfWApXG4gICAgfVxuICAgIGlmICh0aGlzLm92ZXJSaWRlUGFydFNpemUpIHtcbiAgICAgIHJldHVybiB0aGlzLnBhcnRTaXplXG4gICAgfVxuICAgIHZhciBwYXJ0U2l6ZSA9IHRoaXMucGFydFNpemVcbiAgICBmb3IgKDs7KSB7XG4gICAgICAvLyB3aGlsZSh0cnVlKSB7Li4ufSB0aHJvd3MgbGludGluZyBlcnJvci5cbiAgICAgIC8vIElmIHBhcnRTaXplIGlzIGJpZyBlbm91Z2ggdG8gYWNjb21vZGF0ZSB0aGUgb2JqZWN0IHNpemUsIHRoZW4gdXNlIGl0LlxuICAgICAgaWYgKHBhcnRTaXplICogMTAwMDAgPiBzaXplKSB7XG4gICAgICAgIHJldHVybiBwYXJ0U2l6ZVxuICAgICAgfVxuICAgICAgLy8gVHJ5IHBhcnQgc2l6ZXMgYXMgNjRNQiwgODBNQiwgOTZNQiBldGMuXG4gICAgICBwYXJ0U2l6ZSArPSAxNiAqIDEwMjQgKiAxMDI0XG4gICAgfVxuICB9XG5cbiAgLy8gQ3JlYXRlcyB0aGUgYnVja2V0IGBidWNrZXROYW1lYC5cbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXyAtIE5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGByZWdpb25gIF9zdHJpbmdfIC0gcmVnaW9uIHZhbGlkIHZhbHVlcyBhcmUgX3VzLXdlc3QtMV8sIF91cy13ZXN0LTJfLCAgX2V1LXdlc3QtMV8sIF9ldS1jZW50cmFsLTFfLCBfYXAtc291dGhlYXN0LTFfLCBfYXAtbm9ydGhlYXN0LTFfLCBfYXAtc291dGhlYXN0LTJfLCBfc2EtZWFzdC0xXy5cbiAgLy8gKiBgbWFrZU9wdHNgIF9vYmplY3RfIC0gT3B0aW9ucyB0byBjcmVhdGUgYSBidWNrZXQuIGUuZyB7T2JqZWN0TG9ja2luZzp0cnVlfSAoT3B0aW9uYWwpXG4gIC8vICogYGNhbGxiYWNrKGVycilgIF9mdW5jdGlvbl8gLSBjYWxsYmFjayBmdW5jdGlvbiB3aXRoIGBlcnJgIGFzIHRoZSBlcnJvciBhcmd1bWVudC4gYGVycmAgaXMgbnVsbCBpZiB0aGUgYnVja2V0IGlzIHN1Y2Nlc3NmdWxseSBjcmVhdGVkLlxuICBtYWtlQnVja2V0KGJ1Y2tldE5hbWUsIHJlZ2lvbiwgbWFrZU9wdHMgPSB7fSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICAvLyBCYWNrd2FyZCBDb21wYXRpYmlsaXR5XG4gICAgaWYgKGlzT2JqZWN0KHJlZ2lvbikpIHtcbiAgICAgIGNiID0gbWFrZU9wdHNcbiAgICAgIG1ha2VPcHRzID0gcmVnaW9uXG4gICAgICByZWdpb24gPSAnJ1xuICAgIH1cbiAgICBpZiAoaXNGdW5jdGlvbihyZWdpb24pKSB7XG4gICAgICBjYiA9IHJlZ2lvblxuICAgICAgcmVnaW9uID0gJydcbiAgICAgIG1ha2VPcHRzID0ge31cbiAgICB9XG4gICAgaWYgKGlzRnVuY3Rpb24obWFrZU9wdHMpKSB7XG4gICAgICBjYiA9IG1ha2VPcHRzXG4gICAgICBtYWtlT3B0cyA9IHt9XG4gICAgfVxuXG4gICAgaWYgKCFpc1N0cmluZyhyZWdpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWdpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QobWFrZU9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtYWtlT3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICB2YXIgcGF5bG9hZCA9ICcnXG5cbiAgICAvLyBSZWdpb24gYWxyZWFkeSBzZXQgaW4gY29uc3RydWN0b3IsIHZhbGlkYXRlIGlmXG4gICAgLy8gY2FsbGVyIHJlcXVlc3RlZCBidWNrZXQgbG9jYXRpb24gaXMgc2FtZS5cbiAgICBpZiAocmVnaW9uICYmIHRoaXMucmVnaW9uKSB7XG4gICAgICBpZiAocmVnaW9uICE9PSB0aGlzLnJlZ2lvbikge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBDb25maWd1cmVkIHJlZ2lvbiAke3RoaXMucmVnaW9ufSwgcmVxdWVzdGVkICR7cmVnaW9ufWApXG4gICAgICB9XG4gICAgfVxuICAgIC8vIHNlbmRpbmcgbWFrZUJ1Y2tldCByZXF1ZXN0IHdpdGggWE1MIGNvbnRhaW5pbmcgJ3VzLWVhc3QtMScgZmFpbHMuIEZvclxuICAgIC8vIGRlZmF1bHQgcmVnaW9uIHNlcnZlciBleHBlY3RzIHRoZSByZXF1ZXN0IHdpdGhvdXQgYm9keVxuICAgIGlmIChyZWdpb24gJiYgcmVnaW9uICE9PSBERUZBVUxUX1JFR0lPTikge1xuICAgICAgdmFyIGNyZWF0ZUJ1Y2tldENvbmZpZ3VyYXRpb24gPSBbXVxuICAgICAgY3JlYXRlQnVja2V0Q29uZmlndXJhdGlvbi5wdXNoKHtcbiAgICAgICAgX2F0dHI6IHtcbiAgICAgICAgICB4bWxuczogJ2h0dHA6Ly9zMy5hbWF6b25hd3MuY29tL2RvYy8yMDA2LTAzLTAxLycsXG4gICAgICAgIH0sXG4gICAgICB9KVxuICAgICAgY3JlYXRlQnVja2V0Q29uZmlndXJhdGlvbi5wdXNoKHtcbiAgICAgICAgTG9jYXRpb25Db25zdHJhaW50OiByZWdpb24sXG4gICAgICB9KVxuICAgICAgdmFyIHBheWxvYWRPYmplY3QgPSB7XG4gICAgICAgIENyZWF0ZUJ1Y2tldENvbmZpZ3VyYXRpb246IGNyZWF0ZUJ1Y2tldENvbmZpZ3VyYXRpb24sXG4gICAgICB9XG4gICAgICBwYXlsb2FkID0gWG1sKHBheWxvYWRPYmplY3QpXG4gICAgfVxuICAgIHZhciBtZXRob2QgPSAnUFVUJ1xuICAgIHZhciBoZWFkZXJzID0ge31cblxuICAgIGlmIChtYWtlT3B0cy5PYmplY3RMb2NraW5nKSB7XG4gICAgICBoZWFkZXJzWyd4LWFtei1idWNrZXQtb2JqZWN0LWxvY2stZW5hYmxlZCddID0gdHJ1ZVxuICAgIH1cblxuICAgIGlmICghcmVnaW9uKSB7XG4gICAgICByZWdpb24gPSBERUZBVUxUX1JFR0lPTlxuICAgIH1cblxuICAgIGNvbnN0IHByb2Nlc3NXaXRoUmV0cnkgPSAoZXJyKSA9PiB7XG4gICAgICBpZiAoZXJyICYmIChyZWdpb24gPT09ICcnIHx8IHJlZ2lvbiA9PT0gREVGQVVMVF9SRUdJT04pKSB7XG4gICAgICAgIGlmIChlcnIuY29kZSA9PT0gJ0F1dGhvcml6YXRpb25IZWFkZXJNYWxmb3JtZWQnICYmIGVyci5yZWdpb24gIT09ICcnKSB7XG4gICAgICAgICAgLy8gUmV0cnkgd2l0aCByZWdpb24gcmV0dXJuZWQgYXMgcGFydCBvZiBlcnJvclxuICAgICAgICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIGhlYWRlcnMgfSwgcGF5bG9hZCwgWzIwMF0sIGVyci5yZWdpb24sIGZhbHNlLCBjYilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gY2IgJiYgY2IoZXJyKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gY2IgJiYgY2IoZXJyKVxuICAgIH1cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBoZWFkZXJzIH0sIHBheWxvYWQsIFsyMDBdLCByZWdpb24sIGZhbHNlLCBwcm9jZXNzV2l0aFJldHJ5KVxuICB9XG5cbiAgLy8gUmV0dXJucyBhIHN0cmVhbSB0aGF0IGVtaXRzIG9iamVjdHMgdGhhdCBhcmUgcGFydGlhbGx5IHVwbG9hZGVkLlxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgcHJlZml4YCBfc3RyaW5nXzogcHJlZml4IG9mIHRoZSBvYmplY3QgbmFtZXMgdGhhdCBhcmUgcGFydGlhbGx5IHVwbG9hZGVkIChvcHRpb25hbCwgZGVmYXVsdCBgJydgKVxuICAvLyAqIGByZWN1cnNpdmVgIF9ib29sXzogZGlyZWN0b3J5IHN0eWxlIGxpc3Rpbmcgd2hlbiBmYWxzZSwgcmVjdXJzaXZlIGxpc3Rpbmcgd2hlbiB0cnVlIChvcHRpb25hbCwgZGVmYXVsdCBgZmFsc2VgKVxuICAvL1xuICAvLyBfX1JldHVybiBWYWx1ZV9fXG4gIC8vICogYHN0cmVhbWAgX1N0cmVhbV8gOiBlbWl0cyBvYmplY3RzIG9mIHRoZSBmb3JtYXQ6XG4gIC8vICAgKiBgb2JqZWN0LmtleWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAgICogYG9iamVjdC51cGxvYWRJZGAgX3N0cmluZ186IHVwbG9hZCBJRCBvZiB0aGUgb2JqZWN0XG4gIC8vICAgKiBgb2JqZWN0LnNpemVgIF9JbnRlZ2VyXzogc2l6ZSBvZiB0aGUgcGFydGlhbGx5IHVwbG9hZGVkIG9iamVjdFxuICBsaXN0SW5jb21wbGV0ZVVwbG9hZHMoYnVja2V0LCBwcmVmaXgsIHJlY3Vyc2l2ZSkge1xuICAgIGlmIChwcmVmaXggPT09IHVuZGVmaW5lZCkge1xuICAgICAgcHJlZml4ID0gJydcbiAgICB9XG4gICAgaWYgKHJlY3Vyc2l2ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZWN1cnNpdmUgPSBmYWxzZVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkUHJlZml4KHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFByZWZpeEVycm9yKGBJbnZhbGlkIHByZWZpeCA6ICR7cHJlZml4fWApXG4gICAgfVxuICAgIGlmICghaXNCb29sZWFuKHJlY3Vyc2l2ZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlY3Vyc2l2ZSBzaG91bGQgYmUgb2YgdHlwZSBcImJvb2xlYW5cIicpXG4gICAgfVxuICAgIHZhciBkZWxpbWl0ZXIgPSByZWN1cnNpdmUgPyAnJyA6ICcvJ1xuICAgIHZhciBrZXlNYXJrZXIgPSAnJ1xuICAgIHZhciB1cGxvYWRJZE1hcmtlciA9ICcnXG4gICAgdmFyIHVwbG9hZHMgPSBbXVxuICAgIHZhciBlbmRlZCA9IGZhbHNlXG4gICAgdmFyIHJlYWRTdHJlYW0gPSBTdHJlYW0uUmVhZGFibGUoeyBvYmplY3RNb2RlOiB0cnVlIH0pXG4gICAgcmVhZFN0cmVhbS5fcmVhZCA9ICgpID0+IHtcbiAgICAgIC8vIHB1c2ggb25lIHVwbG9hZCBpbmZvIHBlciBfcmVhZCgpXG4gICAgICBpZiAodXBsb2Fkcy5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIHJlYWRTdHJlYW0ucHVzaCh1cGxvYWRzLnNoaWZ0KCkpXG4gICAgICB9XG4gICAgICBpZiAoZW5kZWQpIHtcbiAgICAgICAgcmV0dXJuIHJlYWRTdHJlYW0ucHVzaChudWxsKVxuICAgICAgfVxuICAgICAgdGhpcy5saXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeShidWNrZXQsIHByZWZpeCwga2V5TWFya2VyLCB1cGxvYWRJZE1hcmtlciwgZGVsaW1pdGVyKVxuICAgICAgICAub24oJ2Vycm9yJywgKGUpID0+IHJlYWRTdHJlYW0uZW1pdCgnZXJyb3InLCBlKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKHJlc3VsdCkgPT4ge1xuICAgICAgICAgIHJlc3VsdC5wcmVmaXhlcy5mb3JFYWNoKChwcmVmaXgpID0+IHVwbG9hZHMucHVzaChwcmVmaXgpKVxuICAgICAgICAgIGFzeW5jLmVhY2hTZXJpZXMoXG4gICAgICAgICAgICByZXN1bHQudXBsb2FkcyxcbiAgICAgICAgICAgICh1cGxvYWQsIGNiKSA9PiB7XG4gICAgICAgICAgICAgIC8vIGZvciBlYWNoIGluY29tcGxldGUgdXBsb2FkIGFkZCB0aGUgc2l6ZXMgb2YgaXRzIHVwbG9hZGVkIHBhcnRzXG4gICAgICAgICAgICAgIHRoaXMubGlzdFBhcnRzKGJ1Y2tldCwgdXBsb2FkLmtleSwgdXBsb2FkLnVwbG9hZElkKS50aGVuKChwYXJ0cykgPT4ge1xuICAgICAgICAgICAgICAgIHVwbG9hZC5zaXplID0gcGFydHMucmVkdWNlKChhY2MsIGl0ZW0pID0+IGFjYyArIGl0ZW0uc2l6ZSwgMClcbiAgICAgICAgICAgICAgICB1cGxvYWRzLnB1c2godXBsb2FkKVxuICAgICAgICAgICAgICAgIGNiKClcbiAgICAgICAgICAgICAgfSwgY2IpXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgKGVycikgPT4ge1xuICAgICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgcmVhZFN0cmVhbS5lbWl0KCdlcnJvcicsIGVycilcbiAgICAgICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBpZiAocmVzdWx0LmlzVHJ1bmNhdGVkKSB7XG4gICAgICAgICAgICAgICAga2V5TWFya2VyID0gcmVzdWx0Lm5leHRLZXlNYXJrZXJcbiAgICAgICAgICAgICAgICB1cGxvYWRJZE1hcmtlciA9IHJlc3VsdC5uZXh0VXBsb2FkSWRNYXJrZXJcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBlbmRlZCA9IHRydWVcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICByZWFkU3RyZWFtLl9yZWFkKClcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgKVxuICAgICAgICB9KVxuICAgIH1cbiAgICByZXR1cm4gcmVhZFN0cmVhbVxuICB9XG5cbiAgLy8gVG8gY2hlY2sgaWYgYSBidWNrZXQgYWxyZWFkeSBleGlzdHMuXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ18gOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgY2FsbGJhY2soZXJyKWAgX2Z1bmN0aW9uXyA6IGBlcnJgIGlzIGBudWxsYCBpZiB0aGUgYnVja2V0IGV4aXN0c1xuICBidWNrZXRFeGlzdHMoYnVja2V0TmFtZSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICB2YXIgbWV0aG9kID0gJ0hFQUQnXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSB9LCAnJywgWzIwMF0sICcnLCBmYWxzZSwgKGVycikgPT4ge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICBpZiAoZXJyLmNvZGUgPT0gJ05vU3VjaEJ1Y2tldCcgfHwgZXJyLmNvZGUgPT0gJ05vdEZvdW5kJykge1xuICAgICAgICAgIHJldHVybiBjYihudWxsLCBmYWxzZSlcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gY2IoZXJyKVxuICAgICAgfVxuICAgICAgY2IobnVsbCwgdHJ1ZSlcbiAgICB9KVxuICB9XG5cbiAgLy8gUmVtb3ZlIHRoZSBwYXJ0aWFsbHkgdXBsb2FkZWQgb2JqZWN0LlxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgb2JqZWN0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBjYWxsYmFjayhlcnIpYCBfZnVuY3Rpb25fOiBjYWxsYmFjayBmdW5jdGlvbiBpcyBjYWxsZWQgd2l0aCBub24gYG51bGxgIHZhbHVlIGluIGNhc2Ugb2YgZXJyb3JcbiAgcmVtb3ZlSW5jb21wbGV0ZVVwbG9hZChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSXNWYWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIHZhciByZW1vdmVVcGxvYWRJZFxuICAgIGFzeW5jLmR1cmluZyhcbiAgICAgIChjYikgPT4ge1xuICAgICAgICB0aGlzLmZpbmRVcGxvYWRJZChidWNrZXROYW1lLCBvYmplY3ROYW1lLCAoZSwgdXBsb2FkSWQpID0+IHtcbiAgICAgICAgICBpZiAoZSkge1xuICAgICAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICAgICAgfVxuICAgICAgICAgIHJlbW92ZVVwbG9hZElkID0gdXBsb2FkSWRcbiAgICAgICAgICBjYihudWxsLCB1cGxvYWRJZClcbiAgICAgICAgfSlcbiAgICAgIH0sXG4gICAgICAoY2IpID0+IHtcbiAgICAgICAgdmFyIG1ldGhvZCA9ICdERUxFVEUnXG4gICAgICAgIHZhciBxdWVyeSA9IGB1cGxvYWRJZD0ke3JlbW92ZVVwbG9hZElkfWBcbiAgICAgICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDRdLCAnJywgZmFsc2UsIChlKSA9PiBjYihlKSlcbiAgICAgIH0sXG4gICAgICBjYixcbiAgICApXG4gIH1cblxuICAvLyBDYWxsYmFjayBpcyBjYWxsZWQgd2l0aCBgZXJyb3JgIGluIGNhc2Ugb2YgZXJyb3Igb3IgYG51bGxgIGluIGNhc2Ugb2Ygc3VjY2Vzc1xuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgb2JqZWN0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBmaWxlUGF0aGAgX3N0cmluZ186IHBhdGggdG8gd2hpY2ggdGhlIG9iamVjdCBkYXRhIHdpbGwgYmUgd3JpdHRlbiB0b1xuICAvLyAqIGBnZXRPcHRzYCBfb2JqZWN0XzogVmVyc2lvbiBvZiB0aGUgb2JqZWN0IGluIHRoZSBmb3JtIGB7dmVyc2lvbklkOidteS11dWlkJ31gLiBEZWZhdWx0IGlzIGB7fWAuIChvcHRpb25hbClcbiAgLy8gKiBgY2FsbGJhY2soZXJyKWAgX2Z1bmN0aW9uXzogY2FsbGJhY2sgaXMgY2FsbGVkIHdpdGggYGVycmAgaW4gY2FzZSBvZiBlcnJvci5cbiAgZkdldE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBmaWxlUGF0aCwgZ2V0T3B0cyA9IHt9LCBjYikge1xuICAgIC8vIElucHV0IHZhbGlkYXRpb24uXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhmaWxlUGF0aCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2ZpbGVQYXRoIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICAvLyBCYWNrd2FyZCBDb21wYXRpYmlsaXR5XG4gICAgaWYgKGlzRnVuY3Rpb24oZ2V0T3B0cykpIHtcbiAgICAgIGNiID0gZ2V0T3B0c1xuICAgICAgZ2V0T3B0cyA9IHt9XG4gICAgfVxuXG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICAvLyBJbnRlcm5hbCBkYXRhLlxuICAgIHZhciBwYXJ0RmlsZVxuICAgIHZhciBwYXJ0RmlsZVN0cmVhbVxuICAgIHZhciBvYmpTdGF0XG5cbiAgICAvLyBSZW5hbWUgd3JhcHBlci5cbiAgICB2YXIgcmVuYW1lID0gKGVycikgPT4ge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICByZXR1cm4gY2IoZXJyKVxuICAgICAgfVxuICAgICAgZnMucmVuYW1lKHBhcnRGaWxlLCBmaWxlUGF0aCwgY2IpXG4gICAgfVxuXG4gICAgYXN5bmMud2F0ZXJmYWxsKFxuICAgICAgW1xuICAgICAgICAoY2IpID0+IHRoaXMuc3RhdE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBnZXRPcHRzLCBjYiksXG4gICAgICAgIChyZXN1bHQsIGNiKSA9PiB7XG4gICAgICAgICAgb2JqU3RhdCA9IHJlc3VsdFxuICAgICAgICAgIC8vIENyZWF0ZSBhbnkgbWlzc2luZyB0b3AgbGV2ZWwgZGlyZWN0b3JpZXMuXG4gICAgICAgICAgZnMubWtkaXIocGF0aC5kaXJuYW1lKGZpbGVQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSwgKGVycikgPT4gY2IoZXJyKSlcbiAgICAgICAgfSxcbiAgICAgICAgKGNiKSA9PiB7XG4gICAgICAgICAgcGFydEZpbGUgPSBgJHtmaWxlUGF0aH0uJHtvYmpTdGF0LmV0YWd9LnBhcnQubWluaW9gXG4gICAgICAgICAgZnMuc3RhdChwYXJ0RmlsZSwgKGUsIHN0YXRzKSA9PiB7XG4gICAgICAgICAgICB2YXIgb2Zmc2V0ID0gMFxuICAgICAgICAgICAgaWYgKGUpIHtcbiAgICAgICAgICAgICAgcGFydEZpbGVTdHJlYW0gPSBmcy5jcmVhdGVXcml0ZVN0cmVhbShwYXJ0RmlsZSwgeyBmbGFnczogJ3cnIH0pXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBpZiAob2JqU3RhdC5zaXplID09PSBzdGF0cy5zaXplKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlbmFtZSgpXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgb2Zmc2V0ID0gc3RhdHMuc2l6ZVxuICAgICAgICAgICAgICBwYXJ0RmlsZVN0cmVhbSA9IGZzLmNyZWF0ZVdyaXRlU3RyZWFtKHBhcnRGaWxlLCB7IGZsYWdzOiAnYScgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuZ2V0UGFydGlhbE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBvZmZzZXQsIDAsIGdldE9wdHMsIGNiKVxuICAgICAgICAgIH0pXG4gICAgICAgIH0sXG4gICAgICAgIChkb3dubG9hZFN0cmVhbSwgY2IpID0+IHtcbiAgICAgICAgICBwaXBlc2V0dXAoZG93bmxvYWRTdHJlYW0sIHBhcnRGaWxlU3RyZWFtKVxuICAgICAgICAgICAgLm9uKCdlcnJvcicsIChlKSA9PiBjYihlKSlcbiAgICAgICAgICAgIC5vbignZmluaXNoJywgY2IpXG4gICAgICAgIH0sXG4gICAgICAgIChjYikgPT4gZnMuc3RhdChwYXJ0RmlsZSwgY2IpLFxuICAgICAgICAoc3RhdHMsIGNiKSA9PiB7XG4gICAgICAgICAgaWYgKHN0YXRzLnNpemUgPT09IG9ialN0YXQuc2l6ZSkge1xuICAgICAgICAgICAgcmV0dXJuIGNiKClcbiAgICAgICAgICB9XG4gICAgICAgICAgY2IobmV3IEVycm9yKCdTaXplIG1pc21hdGNoIGJldHdlZW4gZG93bmxvYWRlZCBmaWxlIGFuZCB0aGUgb2JqZWN0JykpXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgcmVuYW1lLFxuICAgIClcbiAgfVxuXG4gIC8vIENhbGxiYWNrIGlzIGNhbGxlZCB3aXRoIHJlYWRhYmxlIHN0cmVhbSBvZiB0aGUgb2JqZWN0IGNvbnRlbnQuXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBvYmplY3ROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0XG4gIC8vICogYGdldE9wdHNgIF9vYmplY3RfOiBWZXJzaW9uIG9mIHRoZSBvYmplY3QgaW4gdGhlIGZvcm0gYHt2ZXJzaW9uSWQ6J215LXV1aWQnfWAuIERlZmF1bHQgaXMgYHt9YC4gKG9wdGlvbmFsKVxuICAvLyAqIGBjYWxsYmFjayhlcnIsIHN0cmVhbSlgIF9mdW5jdGlvbl86IGNhbGxiYWNrIGlzIGNhbGxlZCB3aXRoIGBlcnJgIGluIGNhc2Ugb2YgZXJyb3IuIGBzdHJlYW1gIGlzIHRoZSBvYmplY3QgY29udGVudCBzdHJlYW1cbiAgZ2V0T2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGdldE9wdHMgPSB7fSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICAvLyBCYWNrd2FyZCBDb21wYXRpYmlsaXR5XG4gICAgaWYgKGlzRnVuY3Rpb24oZ2V0T3B0cykpIHtcbiAgICAgIGNiID0gZ2V0T3B0c1xuICAgICAgZ2V0T3B0cyA9IHt9XG4gICAgfVxuXG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG4gICAgdGhpcy5nZXRQYXJ0aWFsT2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIDAsIDAsIGdldE9wdHMsIGNiKVxuICB9XG5cbiAgLy8gQ2FsbGJhY2sgaXMgY2FsbGVkIHdpdGggcmVhZGFibGUgc3RyZWFtIG9mIHRoZSBwYXJ0aWFsIG9iamVjdCBjb250ZW50LlxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgb2JqZWN0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBvZmZzZXRgIF9udW1iZXJfOiBvZmZzZXQgb2YgdGhlIG9iamVjdCBmcm9tIHdoZXJlIHRoZSBzdHJlYW0gd2lsbCBzdGFydFxuICAvLyAqIGBsZW5ndGhgIF9udW1iZXJfOiBsZW5ndGggb2YgdGhlIG9iamVjdCB0aGF0IHdpbGwgYmUgcmVhZCBpbiB0aGUgc3RyZWFtIChvcHRpb25hbCwgaWYgbm90IHNwZWNpZmllZCB3ZSByZWFkIHRoZSByZXN0IG9mIHRoZSBmaWxlIGZyb20gdGhlIG9mZnNldClcbiAgLy8gKiBgZ2V0T3B0c2AgX29iamVjdF86IFZlcnNpb24gb2YgdGhlIG9iamVjdCBpbiB0aGUgZm9ybSBge3ZlcnNpb25JZDonbXktdXVpZCd9YC4gRGVmYXVsdCBpcyBge31gLiAob3B0aW9uYWwpXG4gIC8vICogYGNhbGxiYWNrKGVyciwgc3RyZWFtKWAgX2Z1bmN0aW9uXzogY2FsbGJhY2sgaXMgY2FsbGVkIHdpdGggYGVycmAgaW4gY2FzZSBvZiBlcnJvci4gYHN0cmVhbWAgaXMgdGhlIG9iamVjdCBjb250ZW50IHN0cmVhbVxuICBnZXRQYXJ0aWFsT2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIG9mZnNldCwgbGVuZ3RoLCBnZXRPcHRzID0ge30sIGNiKSB7XG4gICAgaWYgKGlzRnVuY3Rpb24obGVuZ3RoKSkge1xuICAgICAgY2IgPSBsZW5ndGhcbiAgICAgIGxlbmd0aCA9IDBcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc051bWJlcihvZmZzZXQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvZmZzZXQgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuICAgIGlmICghaXNOdW1iZXIobGVuZ3RoKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbGVuZ3RoIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cbiAgICAvLyBCYWNrd2FyZCBDb21wYXRpYmlsaXR5XG4gICAgaWYgKGlzRnVuY3Rpb24oZ2V0T3B0cykpIHtcbiAgICAgIGNiID0gZ2V0T3B0c1xuICAgICAgZ2V0T3B0cyA9IHt9XG4gICAgfVxuXG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICB2YXIgcmFuZ2UgPSAnJ1xuICAgIGlmIChvZmZzZXQgfHwgbGVuZ3RoKSB7XG4gICAgICBpZiAob2Zmc2V0KSB7XG4gICAgICAgIHJhbmdlID0gYGJ5dGVzPSR7K29mZnNldH0tYFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmFuZ2UgPSAnYnl0ZXM9MC0nXG4gICAgICAgIG9mZnNldCA9IDBcbiAgICAgIH1cbiAgICAgIGlmIChsZW5ndGgpIHtcbiAgICAgICAgcmFuZ2UgKz0gYCR7K2xlbmd0aCArIG9mZnNldCAtIDF9YFxuICAgICAgfVxuICAgIH1cblxuICAgIHZhciBoZWFkZXJzID0ge31cbiAgICBpZiAocmFuZ2UgIT09ICcnKSB7XG4gICAgICBoZWFkZXJzLnJhbmdlID0gcmFuZ2VcbiAgICB9XG5cbiAgICB2YXIgZXhwZWN0ZWRTdGF0dXNDb2RlcyA9IFsyMDBdXG4gICAgaWYgKHJhbmdlKSB7XG4gICAgICBleHBlY3RlZFN0YXR1c0NvZGVzLnB1c2goMjA2KVxuICAgIH1cbiAgICB2YXIgbWV0aG9kID0gJ0dFVCdcblxuICAgIHZhciBxdWVyeSA9IHF1ZXJ5c3RyaW5nLnN0cmluZ2lmeShnZXRPcHRzKVxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMsIHF1ZXJ5IH0sICcnLCBleHBlY3RlZFN0YXR1c0NvZGVzLCAnJywgdHJ1ZSwgY2IpXG4gIH1cblxuICAvLyBVcGxvYWRzIHRoZSBvYmplY3QgdXNpbmcgY29udGVudHMgZnJvbSBhIGZpbGVcbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYG9iamVjdE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBvYmplY3RcbiAgLy8gKiBgZmlsZVBhdGhgIF9zdHJpbmdfOiBmaWxlIHBhdGggb2YgdGhlIGZpbGUgdG8gYmUgdXBsb2FkZWRcbiAgLy8gKiBgbWV0YURhdGFgIF9KYXZhc2NyaXB0IE9iamVjdF86IG1ldGFEYXRhIGFzc29zY2lhdGVkIHdpdGggdGhlIG9iamVjdFxuICAvLyAqIGBjYWxsYmFjayhlcnIsIG9iakluZm8pYCBfZnVuY3Rpb25fOiBub24gbnVsbCBgZXJyYCBpbmRpY2F0ZXMgZXJyb3IsIGBvYmpJbmZvYCBfb2JqZWN0XyB3aGljaCBjb250YWlucyB2ZXJzaW9uSWQgYW5kIGV0YWcuXG4gIGZQdXRPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZmlsZVBhdGgsIG1ldGFEYXRhLCBjYWxsYmFjaykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKCFpc1N0cmluZyhmaWxlUGF0aCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2ZpbGVQYXRoIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoaXNGdW5jdGlvbihtZXRhRGF0YSkpIHtcbiAgICAgIGNhbGxiYWNrID0gbWV0YURhdGFcbiAgICAgIG1ldGFEYXRhID0ge30gLy8gU2V0IG1ldGFEYXRhIGVtcHR5IGlmIG5vIG1ldGFEYXRhIHByb3ZpZGVkLlxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KG1ldGFEYXRhKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWV0YURhdGEgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgLy8gSW5zZXJ0cyBjb3JyZWN0IGBjb250ZW50LXR5cGVgIGF0dHJpYnV0ZSBiYXNlZCBvbiBtZXRhRGF0YSBhbmQgZmlsZVBhdGhcbiAgICBtZXRhRGF0YSA9IGluc2VydENvbnRlbnRUeXBlKG1ldGFEYXRhLCBmaWxlUGF0aClcblxuICAgIGZzLmxzdGF0KGZpbGVQYXRoLCAoZXJyLCBzdGF0KSA9PiB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpXG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcy5wdXRPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZnMuY3JlYXRlUmVhZFN0cmVhbShmaWxlUGF0aCksIHN0YXQuc2l6ZSwgbWV0YURhdGEsIGNhbGxiYWNrKVxuICAgIH0pXG4gIH1cblxuICAvLyBVcGxvYWRzIHRoZSBvYmplY3QuXG4gIC8vXG4gIC8vIFVwbG9hZGluZyBhIHN0cmVhbVxuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgb2JqZWN0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBzdHJlYW1gIF9TdHJlYW1fOiBSZWFkYWJsZSBzdHJlYW1cbiAgLy8gKiBgc2l6ZWAgX251bWJlcl86IHNpemUgb2YgdGhlIG9iamVjdCAob3B0aW9uYWwpXG4gIC8vICogYGNhbGxiYWNrKGVyciwgZXRhZylgIF9mdW5jdGlvbl86IG5vbiBudWxsIGBlcnJgIGluZGljYXRlcyBlcnJvciwgYGV0YWdgIF9zdHJpbmdfIGlzIHRoZSBldGFnIG9mIHRoZSBvYmplY3QgdXBsb2FkZWQuXG4gIC8vXG4gIC8vIFVwbG9hZGluZyBcIkJ1ZmZlclwiIG9yIFwic3RyaW5nXCJcbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYG9iamVjdE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBvYmplY3RcbiAgLy8gKiBgc3RyaW5nIG9yIEJ1ZmZlcmAgX3N0cmluZ18gb3IgX0J1ZmZlcl86IHN0cmluZyBvciBidWZmZXJcbiAgLy8gKiBgY2FsbGJhY2soZXJyLCBvYmpJbmZvKWAgX2Z1bmN0aW9uXzogYGVycmAgaXMgYG51bGxgIGluIGNhc2Ugb2Ygc3VjY2VzcyBhbmQgYGluZm9gIHdpbGwgaGF2ZSB0aGUgZm9sbG93aW5nIG9iamVjdCBkZXRhaWxzOlxuICAvLyAgICogYGV0YWdgIF9zdHJpbmdfOiBldGFnIG9mIHRoZSBvYmplY3RcbiAgLy8gICAqIGB2ZXJzaW9uSWRgIF9zdHJpbmdfOiB2ZXJzaW9uSWQgb2YgdGhlIG9iamVjdFxuICBwdXRPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgc3RyZWFtLCBzaXplLCBtZXRhRGF0YSwgY2FsbGJhY2spIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIC8vIFdlJ2xsIG5lZWQgdG8gc2hpZnQgYXJndW1lbnRzIHRvIHRoZSBsZWZ0IGJlY2F1c2Ugb2Ygc2l6ZSBhbmQgbWV0YURhdGEuXG4gICAgaWYgKGlzRnVuY3Rpb24oc2l6ZSkpIHtcbiAgICAgIGNhbGxiYWNrID0gc2l6ZVxuICAgICAgbWV0YURhdGEgPSB7fVxuICAgIH0gZWxzZSBpZiAoaXNGdW5jdGlvbihtZXRhRGF0YSkpIHtcbiAgICAgIGNhbGxiYWNrID0gbWV0YURhdGFcbiAgICAgIG1ldGFEYXRhID0ge31cbiAgICB9XG5cbiAgICAvLyBXZSdsbCBuZWVkIHRvIHNoaWZ0IGFyZ3VtZW50cyB0byB0aGUgbGVmdCBiZWNhdXNlIG9mIG1ldGFEYXRhXG4gICAgLy8gYW5kIHNpemUgYmVpbmcgb3B0aW9uYWwuXG4gICAgaWYgKGlzT2JqZWN0KHNpemUpKSB7XG4gICAgICBtZXRhRGF0YSA9IHNpemVcbiAgICB9XG5cbiAgICAvLyBFbnN1cmVzIE1ldGFkYXRhIGhhcyBhcHByb3ByaWF0ZSBwcmVmaXggZm9yIEEzIEFQSVxuICAgIG1ldGFEYXRhID0gcHJlcGVuZFhBTVpNZXRhKG1ldGFEYXRhKVxuICAgIGlmICh0eXBlb2Ygc3RyZWFtID09PSAnc3RyaW5nJyB8fCBzdHJlYW0gaW5zdGFuY2VvZiBCdWZmZXIpIHtcbiAgICAgIC8vIEFkYXB0cyB0aGUgbm9uLXN0cmVhbSBpbnRlcmZhY2UgaW50byBhIHN0cmVhbS5cbiAgICAgIHNpemUgPSBzdHJlYW0ubGVuZ3RoXG4gICAgICBzdHJlYW0gPSByZWFkYWJsZVN0cmVhbShzdHJlYW0pXG4gICAgfSBlbHNlIGlmICghaXNSZWFkYWJsZVN0cmVhbShzdHJlYW0pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd0aGlyZCBhcmd1bWVudCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmVhbS5SZWFkYWJsZVwiIG9yIFwiQnVmZmVyXCIgb3IgXCJzdHJpbmdcIicpXG4gICAgfVxuXG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNhbGxiYWNrKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICBpZiAoaXNOdW1iZXIoc2l6ZSkgJiYgc2l6ZSA8IDApIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYHNpemUgY2Fubm90IGJlIG5lZ2F0aXZlLCBnaXZlbiBzaXplOiAke3NpemV9YClcbiAgICB9XG5cbiAgICAvLyBHZXQgdGhlIHBhcnQgc2l6ZSBhbmQgZm9yd2FyZCB0aGF0IHRvIHRoZSBCbG9ja1N0cmVhbS4gRGVmYXVsdCB0byB0aGVcbiAgICAvLyBsYXJnZXN0IGJsb2NrIHNpemUgcG9zc2libGUgaWYgbmVjZXNzYXJ5LlxuICAgIGlmICghaXNOdW1iZXIoc2l6ZSkpIHtcbiAgICAgIHNpemUgPSB0aGlzLm1heE9iamVjdFNpemVcbiAgICB9XG5cbiAgICBzaXplID0gdGhpcy5jYWxjdWxhdGVQYXJ0U2l6ZShzaXplKVxuXG4gICAgLy8gczMgcmVxdWlyZXMgdGhhdCBhbGwgbm9uLWVuZCBjaHVua3MgYmUgYXQgbGVhc3QgYHRoaXMucGFydFNpemVgLFxuICAgIC8vIHNvIHdlIGNodW5rIHRoZSBzdHJlYW0gdW50aWwgd2UgaGl0IGVpdGhlciB0aGF0IHNpemUgb3IgdGhlIGVuZCBiZWZvcmVcbiAgICAvLyB3ZSBmbHVzaCBpdCB0byBzMy5cbiAgICBsZXQgY2h1bmtlciA9IG5ldyBCbG9ja1N0cmVhbTIoeyBzaXplLCB6ZXJvUGFkZGluZzogZmFsc2UgfSlcblxuICAgIC8vIFRoaXMgaXMgYSBXcml0YWJsZSBzdHJlYW0gdGhhdCBjYW4gYmUgd3JpdHRlbiB0byBpbiBvcmRlciB0byB1cGxvYWRcbiAgICAvLyB0byB0aGUgc3BlY2lmaWVkIGJ1Y2tldCBhbmQgb2JqZWN0IGF1dG9tYXRpY2FsbHkuXG4gICAgbGV0IHVwbG9hZGVyID0gbmV3IE9iamVjdFVwbG9hZGVyKHRoaXMsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHNpemUsIG1ldGFEYXRhLCBjYWxsYmFjaylcbiAgICAvLyBzdHJlYW0gPT4gY2h1bmtlciA9PiB1cGxvYWRlclxuICAgIHBpcGVzZXR1cChzdHJlYW0sIGNodW5rZXIsIHVwbG9hZGVyKVxuICB9XG5cbiAgLy8gQ29weSB0aGUgb2JqZWN0LlxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgb2JqZWN0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBzcmNPYmplY3RgIF9zdHJpbmdfOiBwYXRoIG9mIHRoZSBzb3VyY2Ugb2JqZWN0IHRvIGJlIGNvcGllZFxuICAvLyAqIGBjb25kaXRpb25zYCBfQ29weUNvbmRpdGlvbnNfOiBjb3B5IGNvbmRpdGlvbnMgdGhhdCBuZWVkcyB0byBiZSBzYXRpc2ZpZWQgKG9wdGlvbmFsLCBkZWZhdWx0IGBudWxsYClcbiAgLy8gKiBgY2FsbGJhY2soZXJyLCB7ZXRhZywgbGFzdE1vZGlmaWVkfSlgIF9mdW5jdGlvbl86IG5vbiBudWxsIGBlcnJgIGluZGljYXRlcyBlcnJvciwgYGV0YWdgIF9zdHJpbmdfIGFuZCBgbGlzdE1vZGlmZWRgIF9EYXRlXyBhcmUgcmVzcGVjdGl2ZWx5IHRoZSBldGFnIGFuZCB0aGUgbGFzdCBtb2RpZmllZCBkYXRlIG9mIHRoZSBuZXdseSBjb3BpZWQgb2JqZWN0XG4gIGNvcHlPYmplY3RWMShhcmcxLCBhcmcyLCBhcmczLCBhcmc0LCBhcmc1KSB7XG4gICAgdmFyIGJ1Y2tldE5hbWUgPSBhcmcxXG4gICAgdmFyIG9iamVjdE5hbWUgPSBhcmcyXG4gICAgdmFyIHNyY09iamVjdCA9IGFyZzNcbiAgICB2YXIgY29uZGl0aW9ucywgY2JcbiAgICBpZiAodHlwZW9mIGFyZzQgPT0gJ2Z1bmN0aW9uJyAmJiBhcmc1ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbmRpdGlvbnMgPSBudWxsXG4gICAgICBjYiA9IGFyZzRcbiAgICB9IGVsc2Uge1xuICAgICAgY29uZGl0aW9ucyA9IGFyZzRcbiAgICAgIGNiID0gYXJnNVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHNyY09iamVjdCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NyY09iamVjdCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKHNyY09iamVjdCA9PT0gJycpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFByZWZpeEVycm9yKGBFbXB0eSBzb3VyY2UgcHJlZml4YClcbiAgICB9XG5cbiAgICBpZiAoY29uZGl0aW9ucyAhPT0gbnVsbCAmJiAhKGNvbmRpdGlvbnMgaW5zdGFuY2VvZiBDb3B5Q29uZGl0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NvbmRpdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJDb3B5Q29uZGl0aW9uc1wiJylcbiAgICB9XG5cbiAgICB2YXIgaGVhZGVycyA9IHt9XG4gICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UnXSA9IHVyaVJlc291cmNlRXNjYXBlKHNyY09iamVjdClcblxuICAgIGlmIChjb25kaXRpb25zICE9PSBudWxsKSB7XG4gICAgICBpZiAoY29uZGl0aW9ucy5tb2RpZmllZCAhPT0gJycpIHtcbiAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtaWYtbW9kaWZpZWQtc2luY2UnXSA9IGNvbmRpdGlvbnMubW9kaWZpZWRcbiAgICAgIH1cbiAgICAgIGlmIChjb25kaXRpb25zLnVubW9kaWZpZWQgIT09ICcnKSB7XG4gICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLWlmLXVubW9kaWZpZWQtc2luY2UnXSA9IGNvbmRpdGlvbnMudW5tb2RpZmllZFxuICAgICAgfVxuICAgICAgaWYgKGNvbmRpdGlvbnMubWF0Y2hFVGFnICE9PSAnJykge1xuICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1pZi1tYXRjaCddID0gY29uZGl0aW9ucy5tYXRjaEVUYWdcbiAgICAgIH1cbiAgICAgIGlmIChjb25kaXRpb25zLm1hdGNoRXRhZ0V4Y2VwdCAhPT0gJycpIHtcbiAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtaWYtbm9uZS1tYXRjaCddID0gY29uZGl0aW9ucy5tYXRjaEVUYWdFeGNlcHRcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgbWV0aG9kID0gJ1BVVCdcbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzIH0sICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG4gICAgICB2YXIgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMuZ2V0Q29weU9iamVjdFRyYW5zZm9ybWVyKClcbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXIpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gY2IoZSkpXG4gICAgICAgIC5vbignZGF0YScsIChkYXRhKSA9PiBjYihudWxsLCBkYXRhKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEludGVybmFsIE1ldGhvZCB0byBwZXJmb3JtIGNvcHkgb2YgYW4gb2JqZWN0LlxuICAgKiBAcGFyYW0gc291cmNlQ29uZmlnIF9fb2JqZWN0X18gICBpbnN0YW5jZSBvZiBDb3B5U291cmNlT3B0aW9ucyBAbGluayAuL2hlbHBlcnMvQ29weVNvdXJjZU9wdGlvbnNcbiAgICogQHBhcmFtIGRlc3RDb25maWcgIF9fb2JqZWN0X18gICBpbnN0YW5jZSBvZiBDb3B5RGVzdGluYXRpb25PcHRpb25zIEBsaW5rIC4vaGVscGVycy9Db3B5RGVzdGluYXRpb25PcHRpb25zXG4gICAqIEBwYXJhbSBjYiBfX2Z1bmN0aW9uX18gY2FsbGVkIHdpdGggbnVsbCBpZiB0aGVyZSBpcyBhbiBlcnJvclxuICAgKiBAcmV0dXJucyBQcm9taXNlIGlmIG5vIGNhbGxhY2sgaXMgcGFzc2VkLlxuICAgKi9cbiAgY29weU9iamVjdFYyKHNvdXJjZUNvbmZpZywgZGVzdENvbmZpZywgY2IpIHtcbiAgICBpZiAoIShzb3VyY2VDb25maWcgaW5zdGFuY2VvZiBDb3B5U291cmNlT3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3NvdXJjZUNvbmZpZyBzaG91bGQgb2YgdHlwZSBDb3B5U291cmNlT3B0aW9ucyAnKVxuICAgIH1cbiAgICBpZiAoIShkZXN0Q29uZmlnIGluc3RhbmNlb2YgQ29weURlc3RpbmF0aW9uT3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2Rlc3RDb25maWcgc2hvdWxkIG9mIHR5cGUgQ29weURlc3RpbmF0aW9uT3B0aW9ucyAnKVxuICAgIH1cbiAgICBpZiAoIWRlc3RDb25maWcudmFsaWRhdGUoKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICAgIGlmICghZGVzdENvbmZpZy52YWxpZGF0ZSgpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICBjb25zdCBoZWFkZXJzID0gT2JqZWN0LmFzc2lnbih7fSwgc291cmNlQ29uZmlnLmdldEhlYWRlcnMoKSwgZGVzdENvbmZpZy5nZXRIZWFkZXJzKCkpXG5cbiAgICBjb25zdCBidWNrZXROYW1lID0gZGVzdENvbmZpZy5CdWNrZXRcbiAgICBjb25zdCBvYmplY3ROYW1lID0gZGVzdENvbmZpZy5PYmplY3RcblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycyB9LCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuICAgICAgY29uc3QgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMuZ2V0Q29weU9iamVjdFRyYW5zZm9ybWVyKClcbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXIpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gY2IoZSkpXG4gICAgICAgIC5vbignZGF0YScsIChkYXRhKSA9PiB7XG4gICAgICAgICAgY29uc3QgcmVzSGVhZGVycyA9IHJlc3BvbnNlLmhlYWRlcnNcblxuICAgICAgICAgIGNvbnN0IGNvcHlPYmpSZXNwb25zZSA9IHtcbiAgICAgICAgICAgIEJ1Y2tldDogZGVzdENvbmZpZy5CdWNrZXQsXG4gICAgICAgICAgICBLZXk6IGRlc3RDb25maWcuT2JqZWN0LFxuICAgICAgICAgICAgTGFzdE1vZGlmaWVkOiBkYXRhLkxhc3RNb2RpZmllZCxcbiAgICAgICAgICAgIE1ldGFEYXRhOiBleHRyYWN0TWV0YWRhdGEocmVzSGVhZGVycyksXG4gICAgICAgICAgICBWZXJzaW9uSWQ6IGdldFZlcnNpb25JZChyZXNIZWFkZXJzKSxcbiAgICAgICAgICAgIFNvdXJjZVZlcnNpb25JZDogZ2V0U291cmNlVmVyc2lvbklkKHJlc0hlYWRlcnMpLFxuICAgICAgICAgICAgRXRhZzogc2FuaXRpemVFVGFnKHJlc0hlYWRlcnMuZXRhZyksXG4gICAgICAgICAgICBTaXplOiArcmVzSGVhZGVyc1snY29udGVudC1sZW5ndGgnXSxcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gY2IobnVsbCwgY29weU9ialJlc3BvbnNlKVxuICAgICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvLyBCYWNrd2FyZCBjb21wYXRpYmlsaXR5IGZvciBDb3B5IE9iamVjdCBBUEkuXG4gIGNvcHlPYmplY3QoLi4uYWxsQXJncykge1xuICAgIGlmIChhbGxBcmdzWzBdIGluc3RhbmNlb2YgQ29weVNvdXJjZU9wdGlvbnMgJiYgYWxsQXJnc1sxXSBpbnN0YW5jZW9mIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMpIHtcbiAgICAgIHJldHVybiB0aGlzLmNvcHlPYmplY3RWMiguLi5hcmd1bWVudHMpXG4gICAgfVxuICAgIHJldHVybiB0aGlzLmNvcHlPYmplY3RWMSguLi5hcmd1bWVudHMpXG4gIH1cblxuICAvLyBsaXN0IGEgYmF0Y2ggb2Ygb2JqZWN0c1xuICBsaXN0T2JqZWN0c1F1ZXJ5KGJ1Y2tldE5hbWUsIHByZWZpeCwgbWFya2VyLCBsaXN0UXVlcnlPcHRzID0ge30pIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhtYXJrZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtYXJrZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGxldCB7IERlbGltaXRlciwgTWF4S2V5cywgSW5jbHVkZVZlcnNpb24gfSA9IGxpc3RRdWVyeU9wdHNcblxuICAgIGlmICghaXNPYmplY3QobGlzdFF1ZXJ5T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xpc3RRdWVyeU9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgaWYgKCFpc1N0cmluZyhEZWxpbWl0ZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdEZWxpbWl0ZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNOdW1iZXIoTWF4S2V5cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ01heEtleXMgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuXG4gICAgY29uc3QgcXVlcmllcyA9IFtdXG4gICAgLy8gZXNjYXBlIGV2ZXJ5IHZhbHVlIGluIHF1ZXJ5IHN0cmluZywgZXhjZXB0IG1heEtleXNcbiAgICBxdWVyaWVzLnB1c2goYHByZWZpeD0ke3VyaUVzY2FwZShwcmVmaXgpfWApXG4gICAgcXVlcmllcy5wdXNoKGBkZWxpbWl0ZXI9JHt1cmlFc2NhcGUoRGVsaW1pdGVyKX1gKVxuICAgIHF1ZXJpZXMucHVzaChgZW5jb2RpbmctdHlwZT11cmxgKVxuXG4gICAgaWYgKEluY2x1ZGVWZXJzaW9uKSB7XG4gICAgICBxdWVyaWVzLnB1c2goYHZlcnNpb25zYClcbiAgICB9XG5cbiAgICBpZiAobWFya2VyKSB7XG4gICAgICBtYXJrZXIgPSB1cmlFc2NhcGUobWFya2VyKVxuICAgICAgaWYgKEluY2x1ZGVWZXJzaW9uKSB7XG4gICAgICAgIHF1ZXJpZXMucHVzaChga2V5LW1hcmtlcj0ke21hcmtlcn1gKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcXVlcmllcy5wdXNoKGBtYXJrZXI9JHttYXJrZXJ9YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBubyBuZWVkIHRvIGVzY2FwZSBtYXhLZXlzXG4gICAgaWYgKE1heEtleXMpIHtcbiAgICAgIGlmIChNYXhLZXlzID49IDEwMDApIHtcbiAgICAgICAgTWF4S2V5cyA9IDEwMDBcbiAgICAgIH1cbiAgICAgIHF1ZXJpZXMucHVzaChgbWF4LWtleXM9JHtNYXhLZXlzfWApXG4gICAgfVxuICAgIHF1ZXJpZXMuc29ydCgpXG4gICAgdmFyIHF1ZXJ5ID0gJydcbiAgICBpZiAocXVlcmllcy5sZW5ndGggPiAwKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJpZXMuam9pbignJicpfWBcbiAgICB9XG5cbiAgICB2YXIgbWV0aG9kID0gJ0dFVCdcbiAgICB2YXIgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMuZ2V0TGlzdE9iamVjdHNUcmFuc2Zvcm1lcigpXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gdHJhbnNmb3JtZXIuZW1pdCgnZXJyb3InLCBlKVxuICAgICAgfVxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcilcbiAgICB9KVxuICAgIHJldHVybiB0cmFuc2Zvcm1lclxuICB9XG5cbiAgLy8gTGlzdCB0aGUgb2JqZWN0cyBpbiB0aGUgYnVja2V0LlxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgcHJlZml4YCBfc3RyaW5nXzogdGhlIHByZWZpeCBvZiB0aGUgb2JqZWN0cyB0aGF0IHNob3VsZCBiZSBsaXN0ZWQgKG9wdGlvbmFsLCBkZWZhdWx0IGAnJ2ApXG4gIC8vICogYHJlY3Vyc2l2ZWAgX2Jvb2xfOiBgdHJ1ZWAgaW5kaWNhdGVzIHJlY3Vyc2l2ZSBzdHlsZSBsaXN0aW5nIGFuZCBgZmFsc2VgIGluZGljYXRlcyBkaXJlY3Rvcnkgc3R5bGUgbGlzdGluZyBkZWxpbWl0ZWQgYnkgJy8nLiAob3B0aW9uYWwsIGRlZmF1bHQgYGZhbHNlYClcbiAgLy8gKiBgbGlzdE9wdHMgX29iamVjdF86IHF1ZXJ5IHBhcmFtcyB0byBsaXN0IG9iamVjdCB3aXRoIGJlbG93IGtleXNcbiAgLy8gKiAgICBsaXN0T3B0cy5NYXhLZXlzIF9pbnRfIG1heGltdW0gbnVtYmVyIG9mIGtleXMgdG8gcmV0dXJuXG4gIC8vICogICAgbGlzdE9wdHMuSW5jbHVkZVZlcnNpb24gIF9ib29sXyB0cnVlfGZhbHNlIHRvIGluY2x1ZGUgdmVyc2lvbnMuXG4gIC8vIF9fUmV0dXJuIFZhbHVlX19cbiAgLy8gKiBgc3RyZWFtYCBfU3RyZWFtXzogc3RyZWFtIGVtaXR0aW5nIHRoZSBvYmplY3RzIGluIHRoZSBidWNrZXQsIHRoZSBvYmplY3QgaXMgb2YgdGhlIGZvcm1hdDpcbiAgLy8gKiBgb2JqLm5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBvYmplY3RcbiAgLy8gKiBgb2JqLnByZWZpeGAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdCBwcmVmaXhcbiAgLy8gKiBgb2JqLnNpemVgIF9udW1iZXJfOiBzaXplIG9mIHRoZSBvYmplY3RcbiAgLy8gKiBgb2JqLmV0YWdgIF9zdHJpbmdfOiBldGFnIG9mIHRoZSBvYmplY3RcbiAgLy8gKiBgb2JqLmxhc3RNb2RpZmllZGAgX0RhdGVfOiBtb2RpZmllZCB0aW1lIHN0YW1wXG4gIC8vICogYG9iai5pc0RlbGV0ZU1hcmtlcmAgX2Jvb2xlYW5fOiB0cnVlIGlmIGl0IGlzIGEgZGVsZXRlIG1hcmtlclxuICAvLyAqIGBvYmoudmVyc2lvbklkYCBfc3RyaW5nXzogdmVyc2lvbklkIG9mIHRoZSBvYmplY3RcbiAgbGlzdE9iamVjdHMoYnVja2V0TmFtZSwgcHJlZml4LCByZWN1cnNpdmUsIGxpc3RPcHRzID0ge30pIHtcbiAgICBpZiAocHJlZml4ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHByZWZpeCA9ICcnXG4gICAgfVxuICAgIGlmIChyZWN1cnNpdmUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmVjdXJzaXZlID0gZmFsc2VcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkUHJlZml4KHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFByZWZpeEVycm9yKGBJbnZhbGlkIHByZWZpeCA6ICR7cHJlZml4fWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzQm9vbGVhbihyZWN1cnNpdmUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWN1cnNpdmUgc2hvdWxkIGJlIG9mIHR5cGUgXCJib29sZWFuXCInKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGxpc3RPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIHZhciBtYXJrZXIgPSAnJ1xuICAgIGNvbnN0IGxpc3RRdWVyeU9wdHMgPSB7XG4gICAgICBEZWxpbWl0ZXI6IHJlY3Vyc2l2ZSA/ICcnIDogJy8nLCAvLyBpZiByZWN1cnNpdmUgaXMgZmFsc2Ugc2V0IGRlbGltaXRlciB0byAnLydcbiAgICAgIE1heEtleXM6IDEwMDAsXG4gICAgICBJbmNsdWRlVmVyc2lvbjogbGlzdE9wdHMuSW5jbHVkZVZlcnNpb24sXG4gICAgfVxuICAgIHZhciBvYmplY3RzID0gW11cbiAgICB2YXIgZW5kZWQgPSBmYWxzZVxuICAgIHZhciByZWFkU3RyZWFtID0gU3RyZWFtLlJlYWRhYmxlKHsgb2JqZWN0TW9kZTogdHJ1ZSB9KVxuICAgIHJlYWRTdHJlYW0uX3JlYWQgPSAoKSA9PiB7XG4gICAgICAvLyBwdXNoIG9uZSBvYmplY3QgcGVyIF9yZWFkKClcbiAgICAgIGlmIChvYmplY3RzLmxlbmd0aCkge1xuICAgICAgICByZWFkU3RyZWFtLnB1c2gob2JqZWN0cy5zaGlmdCgpKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICAgIGlmIChlbmRlZCkge1xuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKG51bGwpXG4gICAgICB9XG4gICAgICAvLyBpZiB0aGVyZSBhcmUgbm8gb2JqZWN0cyB0byBwdXNoIGRvIHF1ZXJ5IGZvciB0aGUgbmV4dCBiYXRjaCBvZiBvYmplY3RzXG4gICAgICB0aGlzLmxpc3RPYmplY3RzUXVlcnkoYnVja2V0TmFtZSwgcHJlZml4LCBtYXJrZXIsIGxpc3RRdWVyeU9wdHMpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gcmVhZFN0cmVhbS5lbWl0KCdlcnJvcicsIGUpKVxuICAgICAgICAub24oJ2RhdGEnLCAocmVzdWx0KSA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xuICAgICAgICAgICAgbWFya2VyID0gcmVzdWx0Lm5leHRNYXJrZXIgfHwgcmVzdWx0LnZlcnNpb25JZE1hcmtlclxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBlbmRlZCA9IHRydWVcbiAgICAgICAgICB9XG4gICAgICAgICAgb2JqZWN0cyA9IHJlc3VsdC5vYmplY3RzXG4gICAgICAgICAgcmVhZFN0cmVhbS5fcmVhZCgpXG4gICAgICAgIH0pXG4gICAgfVxuICAgIHJldHVybiByZWFkU3RyZWFtXG4gIH1cblxuICAvLyBsaXN0T2JqZWN0c1YyUXVlcnkgLSAoTGlzdCBPYmplY3RzIFYyKSAtIExpc3Qgc29tZSBvciBhbGwgKHVwIHRvIDEwMDApIG9mIHRoZSBvYmplY3RzIGluIGEgYnVja2V0LlxuICAvL1xuICAvLyBZb3UgY2FuIHVzZSB0aGUgcmVxdWVzdCBwYXJhbWV0ZXJzIGFzIHNlbGVjdGlvbiBjcml0ZXJpYSB0byByZXR1cm4gYSBzdWJzZXQgb2YgdGhlIG9iamVjdHMgaW4gYSBidWNrZXQuXG4gIC8vIHJlcXVlc3QgcGFyYW1ldGVycyA6LVxuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYHByZWZpeGAgX3N0cmluZ186IExpbWl0cyB0aGUgcmVzcG9uc2UgdG8ga2V5cyB0aGF0IGJlZ2luIHdpdGggdGhlIHNwZWNpZmllZCBwcmVmaXguXG4gIC8vICogYGNvbnRpbnVhdGlvbi10b2tlbmAgX3N0cmluZ186IFVzZWQgdG8gY29udGludWUgaXRlcmF0aW5nIG92ZXIgYSBzZXQgb2Ygb2JqZWN0cy5cbiAgLy8gKiBgZGVsaW1pdGVyYCBfc3RyaW5nXzogQSBkZWxpbWl0ZXIgaXMgYSBjaGFyYWN0ZXIgeW91IHVzZSB0byBncm91cCBrZXlzLlxuICAvLyAqIGBtYXgta2V5c2AgX251bWJlcl86IFNldHMgdGhlIG1heGltdW0gbnVtYmVyIG9mIGtleXMgcmV0dXJuZWQgaW4gdGhlIHJlc3BvbnNlIGJvZHkuXG4gIC8vICogYHN0YXJ0LWFmdGVyYCBfc3RyaW5nXzogU3BlY2lmaWVzIHRoZSBrZXkgdG8gc3RhcnQgYWZ0ZXIgd2hlbiBsaXN0aW5nIG9iamVjdHMgaW4gYSBidWNrZXQuXG4gIGxpc3RPYmplY3RzVjJRdWVyeShidWNrZXROYW1lLCBwcmVmaXgsIGNvbnRpbnVhdGlvblRva2VuLCBkZWxpbWl0ZXIsIG1heEtleXMsIHN0YXJ0QWZ0ZXIpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhjb250aW51YXRpb25Ub2tlbikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NvbnRpbnVhdGlvblRva2VuIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGRlbGltaXRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2RlbGltaXRlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc051bWJlcihtYXhLZXlzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWF4S2V5cyBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhzdGFydEFmdGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc3RhcnRBZnRlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgdmFyIHF1ZXJpZXMgPSBbXVxuXG4gICAgLy8gQ2FsbCBmb3IgbGlzdGluZyBvYmplY3RzIHYyIEFQSVxuICAgIHF1ZXJpZXMucHVzaChgbGlzdC10eXBlPTJgKVxuICAgIHF1ZXJpZXMucHVzaChgZW5jb2RpbmctdHlwZT11cmxgKVxuXG4gICAgLy8gZXNjYXBlIGV2ZXJ5IHZhbHVlIGluIHF1ZXJ5IHN0cmluZywgZXhjZXB0IG1heEtleXNcbiAgICBxdWVyaWVzLnB1c2goYHByZWZpeD0ke3VyaUVzY2FwZShwcmVmaXgpfWApXG4gICAgcXVlcmllcy5wdXNoKGBkZWxpbWl0ZXI9JHt1cmlFc2NhcGUoZGVsaW1pdGVyKX1gKVxuXG4gICAgaWYgKGNvbnRpbnVhdGlvblRva2VuKSB7XG4gICAgICBjb250aW51YXRpb25Ub2tlbiA9IHVyaUVzY2FwZShjb250aW51YXRpb25Ub2tlbilcbiAgICAgIHF1ZXJpZXMucHVzaChgY29udGludWF0aW9uLXRva2VuPSR7Y29udGludWF0aW9uVG9rZW59YClcbiAgICB9XG4gICAgLy8gU2V0IHN0YXJ0LWFmdGVyXG4gICAgaWYgKHN0YXJ0QWZ0ZXIpIHtcbiAgICAgIHN0YXJ0QWZ0ZXIgPSB1cmlFc2NhcGUoc3RhcnRBZnRlcilcbiAgICAgIHF1ZXJpZXMucHVzaChgc3RhcnQtYWZ0ZXI9JHtzdGFydEFmdGVyfWApXG4gICAgfVxuICAgIC8vIG5vIG5lZWQgdG8gZXNjYXBlIG1heEtleXNcbiAgICBpZiAobWF4S2V5cykge1xuICAgICAgaWYgKG1heEtleXMgPj0gMTAwMCkge1xuICAgICAgICBtYXhLZXlzID0gMTAwMFxuICAgICAgfVxuICAgICAgcXVlcmllcy5wdXNoKGBtYXgta2V5cz0ke21heEtleXN9YClcbiAgICB9XG4gICAgcXVlcmllcy5zb3J0KClcbiAgICB2YXIgcXVlcnkgPSAnJ1xuICAgIGlmIChxdWVyaWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcmllcy5qb2luKCcmJyl9YFxuICAgIH1cbiAgICB2YXIgbWV0aG9kID0gJ0dFVCdcbiAgICB2YXIgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMuZ2V0TGlzdE9iamVjdHNWMlRyYW5zZm9ybWVyKClcbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiB0cmFuc2Zvcm1lci5lbWl0KCdlcnJvcicsIGUpXG4gICAgICB9XG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVyKVxuICAgIH0pXG4gICAgcmV0dXJuIHRyYW5zZm9ybWVyXG4gIH1cblxuICAvLyBMaXN0IHRoZSBvYmplY3RzIGluIHRoZSBidWNrZXQgdXNpbmcgUzMgTGlzdE9iamVjdHMgVjJcbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYHByZWZpeGAgX3N0cmluZ186IHRoZSBwcmVmaXggb2YgdGhlIG9iamVjdHMgdGhhdCBzaG91bGQgYmUgbGlzdGVkIChvcHRpb25hbCwgZGVmYXVsdCBgJydgKVxuICAvLyAqIGByZWN1cnNpdmVgIF9ib29sXzogYHRydWVgIGluZGljYXRlcyByZWN1cnNpdmUgc3R5bGUgbGlzdGluZyBhbmQgYGZhbHNlYCBpbmRpY2F0ZXMgZGlyZWN0b3J5IHN0eWxlIGxpc3RpbmcgZGVsaW1pdGVkIGJ5ICcvJy4gKG9wdGlvbmFsLCBkZWZhdWx0IGBmYWxzZWApXG4gIC8vICogYHN0YXJ0QWZ0ZXJgIF9zdHJpbmdfOiBTcGVjaWZpZXMgdGhlIGtleSB0byBzdGFydCBhZnRlciB3aGVuIGxpc3Rpbmcgb2JqZWN0cyBpbiBhIGJ1Y2tldC4gKG9wdGlvbmFsLCBkZWZhdWx0IGAnJ2ApXG4gIC8vXG4gIC8vIF9fUmV0dXJuIFZhbHVlX19cbiAgLy8gKiBgc3RyZWFtYCBfU3RyZWFtXzogc3RyZWFtIGVtaXR0aW5nIHRoZSBvYmplY3RzIGluIHRoZSBidWNrZXQsIHRoZSBvYmplY3QgaXMgb2YgdGhlIGZvcm1hdDpcbiAgLy8gICAqIGBvYmoubmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAgICogYG9iai5wcmVmaXhgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBvYmplY3QgcHJlZml4XG4gIC8vICAgKiBgb2JqLnNpemVgIF9udW1iZXJfOiBzaXplIG9mIHRoZSBvYmplY3RcbiAgLy8gICAqIGBvYmouZXRhZ2AgX3N0cmluZ186IGV0YWcgb2YgdGhlIG9iamVjdFxuICAvLyAgICogYG9iai5sYXN0TW9kaWZpZWRgIF9EYXRlXzogbW9kaWZpZWQgdGltZSBzdGFtcFxuICBsaXN0T2JqZWN0c1YyKGJ1Y2tldE5hbWUsIHByZWZpeCwgcmVjdXJzaXZlLCBzdGFydEFmdGVyKSB7XG4gICAgaWYgKHByZWZpeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwcmVmaXggPSAnJ1xuICAgIH1cbiAgICBpZiAocmVjdXJzaXZlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJlY3Vyc2l2ZSA9IGZhbHNlXG4gICAgfVxuICAgIGlmIChzdGFydEFmdGVyID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHN0YXJ0QWZ0ZXIgPSAnJ1xuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRQcmVmaXgocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkUHJlZml4RXJyb3IoYEludmFsaWQgcHJlZml4IDogJHtwcmVmaXh9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNCb29sZWFuKHJlY3Vyc2l2ZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlY3Vyc2l2ZSBzaG91bGQgYmUgb2YgdHlwZSBcImJvb2xlYW5cIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoc3RhcnRBZnRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0YXJ0QWZ0ZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIC8vIGlmIHJlY3Vyc2l2ZSBpcyBmYWxzZSBzZXQgZGVsaW1pdGVyIHRvICcvJ1xuICAgIHZhciBkZWxpbWl0ZXIgPSByZWN1cnNpdmUgPyAnJyA6ICcvJ1xuICAgIHZhciBjb250aW51YXRpb25Ub2tlbiA9ICcnXG4gICAgdmFyIG9iamVjdHMgPSBbXVxuICAgIHZhciBlbmRlZCA9IGZhbHNlXG4gICAgdmFyIHJlYWRTdHJlYW0gPSBTdHJlYW0uUmVhZGFibGUoeyBvYmplY3RNb2RlOiB0cnVlIH0pXG4gICAgcmVhZFN0cmVhbS5fcmVhZCA9ICgpID0+IHtcbiAgICAgIC8vIHB1c2ggb25lIG9iamVjdCBwZXIgX3JlYWQoKVxuICAgICAgaWYgKG9iamVjdHMubGVuZ3RoKSB7XG4gICAgICAgIHJlYWRTdHJlYW0ucHVzaChvYmplY3RzLnNoaWZ0KCkpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgICAgaWYgKGVuZGVkKSB7XG4gICAgICAgIHJldHVybiByZWFkU3RyZWFtLnB1c2gobnVsbClcbiAgICAgIH1cbiAgICAgIC8vIGlmIHRoZXJlIGFyZSBubyBvYmplY3RzIHRvIHB1c2ggZG8gcXVlcnkgZm9yIHRoZSBuZXh0IGJhdGNoIG9mIG9iamVjdHNcbiAgICAgIHRoaXMubGlzdE9iamVjdHNWMlF1ZXJ5KGJ1Y2tldE5hbWUsIHByZWZpeCwgY29udGludWF0aW9uVG9rZW4sIGRlbGltaXRlciwgMTAwMCwgc3RhcnRBZnRlcilcbiAgICAgICAgLm9uKCdlcnJvcicsIChlKSA9PiByZWFkU3RyZWFtLmVtaXQoJ2Vycm9yJywgZSkpXG4gICAgICAgIC5vbignZGF0YScsIChyZXN1bHQpID0+IHtcbiAgICAgICAgICBpZiAocmVzdWx0LmlzVHJ1bmNhdGVkKSB7XG4gICAgICAgICAgICBjb250aW51YXRpb25Ub2tlbiA9IHJlc3VsdC5uZXh0Q29udGludWF0aW9uVG9rZW5cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZW5kZWQgPSB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICAgIG9iamVjdHMgPSByZXN1bHQub2JqZWN0c1xuICAgICAgICAgIHJlYWRTdHJlYW0uX3JlYWQoKVxuICAgICAgICB9KVxuICAgIH1cbiAgICByZXR1cm4gcmVhZFN0cmVhbVxuICB9XG5cbiAgLy8gUmVtb3ZlIGFsbCB0aGUgb2JqZWN0cyByZXNpZGluZyBpbiB0aGUgb2JqZWN0c0xpc3QuXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBvYmplY3RzTGlzdGAgX2FycmF5XzogYXJyYXkgb2Ygb2JqZWN0cyBvZiBvbmUgb2YgdGhlIGZvbGxvd2luZzpcbiAgLy8gKiAgICAgICAgIExpc3Qgb2YgT2JqZWN0IG5hbWVzIGFzIGFycmF5IG9mIHN0cmluZ3Mgd2hpY2ggYXJlIG9iamVjdCBrZXlzOiAgWydvYmplY3RuYW1lMScsJ29iamVjdG5hbWUyJ11cbiAgLy8gKiAgICAgICAgIExpc3Qgb2YgT2JqZWN0IG5hbWUgYW5kIHZlcnNpb25JZCBhcyBhbiBvYmplY3Q6ICBbe25hbWU6XCJvYmplY3RuYW1lXCIsdmVyc2lvbklkOlwibXktdmVyc2lvbi1pZFwifV1cblxuICByZW1vdmVPYmplY3RzKGJ1Y2tldE5hbWUsIG9iamVjdHNMaXN0LCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghQXJyYXkuaXNBcnJheShvYmplY3RzTGlzdCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ29iamVjdHNMaXN0IHNob3VsZCBiZSBhIGxpc3QnKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cblxuICAgIGNvbnN0IG1heEVudHJpZXMgPSAxMDAwXG4gICAgY29uc3QgcXVlcnkgPSAnZGVsZXRlJ1xuICAgIGNvbnN0IG1ldGhvZCA9ICdQT1NUJ1xuXG4gICAgbGV0IHJlc3VsdCA9IG9iamVjdHNMaXN0LnJlZHVjZShcbiAgICAgIChyZXN1bHQsIGVudHJ5KSA9PiB7XG4gICAgICAgIHJlc3VsdC5saXN0LnB1c2goZW50cnkpXG4gICAgICAgIGlmIChyZXN1bHQubGlzdC5sZW5ndGggPT09IG1heEVudHJpZXMpIHtcbiAgICAgICAgICByZXN1bHQubGlzdE9mTGlzdC5wdXNoKHJlc3VsdC5saXN0KVxuICAgICAgICAgIHJlc3VsdC5saXN0ID0gW11cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0XG4gICAgICB9LFxuICAgICAgeyBsaXN0T2ZMaXN0OiBbXSwgbGlzdDogW10gfSxcbiAgICApXG5cbiAgICBpZiAocmVzdWx0Lmxpc3QubGVuZ3RoID4gMCkge1xuICAgICAgcmVzdWx0Lmxpc3RPZkxpc3QucHVzaChyZXN1bHQubGlzdClcbiAgICB9XG5cbiAgICBjb25zdCBlbmNvZGVyID0gbmV3IFRleHRFbmNvZGVyKClcbiAgICBjb25zdCBiYXRjaFJlc3VsdHMgPSBbXVxuXG4gICAgYXN5bmMuZWFjaFNlcmllcyhcbiAgICAgIHJlc3VsdC5saXN0T2ZMaXN0LFxuICAgICAgKGxpc3QsIGJhdGNoQ2IpID0+IHtcbiAgICAgICAgdmFyIG9iamVjdHMgPSBbXVxuICAgICAgICBsaXN0LmZvckVhY2goZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgaWYgKGlzT2JqZWN0KHZhbHVlKSkge1xuICAgICAgICAgICAgb2JqZWN0cy5wdXNoKHsgS2V5OiB2YWx1ZS5uYW1lLCBWZXJzaW9uSWQ6IHZhbHVlLnZlcnNpb25JZCB9KVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBvYmplY3RzLnB1c2goeyBLZXk6IHZhbHVlIH0pXG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgICBsZXQgZGVsZXRlT2JqZWN0cyA9IHsgRGVsZXRlOiB7IFF1aWV0OiB0cnVlLCBPYmplY3Q6IG9iamVjdHMgfSB9XG4gICAgICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyBoZWFkbGVzczogdHJ1ZSB9KVxuICAgICAgICBsZXQgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoZGVsZXRlT2JqZWN0cylcbiAgICAgICAgcGF5bG9hZCA9IEJ1ZmZlci5mcm9tKGVuY29kZXIuZW5jb2RlKHBheWxvYWQpKVxuICAgICAgICBjb25zdCBoZWFkZXJzID0ge31cblxuICAgICAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgICAgICBsZXQgcmVtb3ZlT2JqZWN0c1Jlc3VsdFxuICAgICAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgICAgIGlmIChlKSB7XG4gICAgICAgICAgICByZXR1cm4gYmF0Y2hDYihlKVxuICAgICAgICAgIH1cbiAgICAgICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVycy5yZW1vdmVPYmplY3RzVHJhbnNmb3JtZXIoKSlcbiAgICAgICAgICAgIC5vbignZGF0YScsIChkYXRhKSA9PiB7XG4gICAgICAgICAgICAgIHJlbW92ZU9iamVjdHNSZXN1bHQgPSBkYXRhXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLm9uKCdlcnJvcicsIChlKSA9PiB7XG4gICAgICAgICAgICAgIHJldHVybiBiYXRjaENiKGUsIG51bGwpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgICAgIGJhdGNoUmVzdWx0cy5wdXNoKHJlbW92ZU9iamVjdHNSZXN1bHQpXG4gICAgICAgICAgICAgIHJldHVybiBiYXRjaENiKG51bGwsIHJlbW92ZU9iamVjdHNSZXN1bHQpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgICAgfSxcbiAgICAgICgpID0+IHtcbiAgICAgICAgY2IobnVsbCwgXy5mbGF0dGVuKGJhdGNoUmVzdWx0cykpXG4gICAgICB9LFxuICAgIClcbiAgfVxuXG4gIC8vIEdldCB0aGUgcG9saWN5IG9uIGEgYnVja2V0IG9yIGFuIG9iamVjdCBwcmVmaXguXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBjYWxsYmFjayhlcnIsIHBvbGljeSlgIF9mdW5jdGlvbl86IGNhbGxiYWNrIGZ1bmN0aW9uXG4gIGdldEJ1Y2tldFBvbGljeShidWNrZXROYW1lLCBjYikge1xuICAgIC8vIFZhbGlkYXRlIGFyZ3VtZW50cy5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cblxuICAgIGxldCBtZXRob2QgPSAnR0VUJ1xuICAgIGxldCBxdWVyeSA9ICdwb2xpY3knXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gY2IoZSlcbiAgICAgIH1cblxuICAgICAgbGV0IHBvbGljeSA9IEJ1ZmZlci5mcm9tKCcnKVxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcnMuZ2V0Q29uY2F0ZXIoKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKGRhdGEpID0+IChwb2xpY3kgPSBkYXRhKSlcbiAgICAgICAgLm9uKCdlcnJvcicsIGNiKVxuICAgICAgICAub24oJ2VuZCcsICgpID0+IHtcbiAgICAgICAgICBjYihudWxsLCBwb2xpY3kudG9TdHJpbmcoKSlcbiAgICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLy8gU2V0IHRoZSBwb2xpY3kgb24gYSBidWNrZXQgb3IgYW4gb2JqZWN0IHByZWZpeC5cbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYGJ1Y2tldFBvbGljeWAgX3N0cmluZ186IGJ1Y2tldCBwb2xpY3kgKEpTT04gc3RyaW5naWZ5J2VkKVxuICAvLyAqIGBjYWxsYmFjayhlcnIpYCBfZnVuY3Rpb25fOiBjYWxsYmFjayBmdW5jdGlvblxuICBzZXRCdWNrZXRQb2xpY3koYnVja2V0TmFtZSwgcG9saWN5LCBjYikge1xuICAgIC8vIFZhbGlkYXRlIGFyZ3VtZW50cy5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHBvbGljeSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldFBvbGljeUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBwb2xpY3k6ICR7cG9saWN5fSAtIG11c3QgYmUgXCJzdHJpbmdcImApXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuXG4gICAgbGV0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgbGV0IHF1ZXJ5ID0gJ3BvbGljeSdcblxuICAgIGlmIChwb2xpY3kpIHtcbiAgICAgIG1ldGhvZCA9ICdQVVQnXG4gICAgfVxuXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgcG9saWN5LCBbMjA0XSwgJycsIGZhbHNlLCBjYilcbiAgfVxuXG4gIC8vIEdlbmVyYXRlIGEgZ2VuZXJpYyBwcmVzaWduZWQgVVJMIHdoaWNoIGNhbiBiZVxuICAvLyB1c2VkIGZvciBIVFRQIG1ldGhvZHMgR0VULCBQVVQsIEhFQUQgYW5kIERFTEVURVxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYG1ldGhvZGAgX3N0cmluZ186IG5hbWUgb2YgdGhlIEhUVFAgbWV0aG9kXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgb2JqZWN0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBleHBpcnlgIF9udW1iZXJfOiBleHBpcnkgaW4gc2Vjb25kcyAob3B0aW9uYWwsIGRlZmF1bHQgNyBkYXlzKVxuICAvLyAqIGByZXFQYXJhbXNgIF9vYmplY3RfOiByZXF1ZXN0IHBhcmFtZXRlcnMgKG9wdGlvbmFsKSBlLmcge3ZlcnNpb25JZDpcIjEwZmE5OTQ2LTNmNjQtNDEzNy1hNThmLTg4ODA2NWMwNzMyZVwifVxuICAvLyAqIGByZXF1ZXN0RGF0ZWAgX0RhdGVfOiBBIGRhdGUgb2JqZWN0LCB0aGUgdXJsIHdpbGwgYmUgaXNzdWVkIGF0IChvcHRpb25hbClcbiAgcHJlc2lnbmVkVXJsKG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZXhwaXJlcywgcmVxUGFyYW1zLCByZXF1ZXN0RGF0ZSwgY2IpIHtcbiAgICBpZiAodGhpcy5hbm9ueW1vdXMpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuQW5vbnltb3VzUmVxdWVzdEVycm9yKCdQcmVzaWduZWQgJyArIG1ldGhvZCArICcgdXJsIGNhbm5vdCBiZSBnZW5lcmF0ZWQgZm9yIGFub255bW91cyByZXF1ZXN0cycpXG4gICAgfVxuICAgIGlmIChpc0Z1bmN0aW9uKHJlcXVlc3REYXRlKSkge1xuICAgICAgY2IgPSByZXF1ZXN0RGF0ZVxuICAgICAgcmVxdWVzdERhdGUgPSBuZXcgRGF0ZSgpXG4gICAgfVxuICAgIGlmIChpc0Z1bmN0aW9uKHJlcVBhcmFtcykpIHtcbiAgICAgIGNiID0gcmVxUGFyYW1zXG4gICAgICByZXFQYXJhbXMgPSB7fVxuICAgICAgcmVxdWVzdERhdGUgPSBuZXcgRGF0ZSgpXG4gICAgfVxuICAgIGlmIChpc0Z1bmN0aW9uKGV4cGlyZXMpKSB7XG4gICAgICBjYiA9IGV4cGlyZXNcbiAgICAgIHJlcVBhcmFtcyA9IHt9XG4gICAgICBleHBpcmVzID0gMjQgKiA2MCAqIDYwICogNyAvLyA3IGRheXMgaW4gc2Vjb25kc1xuICAgICAgcmVxdWVzdERhdGUgPSBuZXcgRGF0ZSgpXG4gICAgfVxuICAgIGlmICghaXNOdW1iZXIoZXhwaXJlcykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2V4cGlyZXMgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QocmVxUGFyYW1zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxUGFyYW1zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWREYXRlKHJlcXVlc3REYXRlKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxdWVzdERhdGUgc2hvdWxkIGJlIG9mIHR5cGUgXCJEYXRlXCIgYW5kIHZhbGlkJylcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG4gICAgdmFyIHF1ZXJ5ID0gcXVlcnlzdHJpbmcuc3RyaW5naWZ5KHJlcVBhcmFtcylcbiAgICB0aGlzLmdldEJ1Y2tldFJlZ2lvbihidWNrZXROYW1lLCAoZSwgcmVnaW9uKSA9PiB7XG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gY2IoZSlcbiAgICAgIH1cbiAgICAgIC8vIFRoaXMgc3RhdGVtZW50IGlzIGFkZGVkIHRvIGVuc3VyZSB0aGF0IHdlIHNlbmQgZXJyb3IgdGhyb3VnaFxuICAgICAgLy8gY2FsbGJhY2sgb24gcHJlc2lnbiBmYWlsdXJlLlxuICAgICAgdmFyIHVybFxuICAgICAgdmFyIHJlcU9wdGlvbnMgPSB0aGlzLmdldFJlcXVlc3RPcHRpb25zKHsgbWV0aG9kLCByZWdpb24sIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0pXG5cbiAgICAgIHRoaXMuY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKVxuICAgICAgdHJ5IHtcbiAgICAgICAgdXJsID0gcHJlc2lnblNpZ25hdHVyZVY0KFxuICAgICAgICAgIHJlcU9wdGlvbnMsXG4gICAgICAgICAgdGhpcy5hY2Nlc3NLZXksXG4gICAgICAgICAgdGhpcy5zZWNyZXRLZXksXG4gICAgICAgICAgdGhpcy5zZXNzaW9uVG9rZW4sXG4gICAgICAgICAgcmVnaW9uLFxuICAgICAgICAgIHJlcXVlc3REYXRlLFxuICAgICAgICAgIGV4cGlyZXMsXG4gICAgICAgIClcbiAgICAgIH0gY2F0Y2ggKHBlKSB7XG4gICAgICAgIHJldHVybiBjYihwZSlcbiAgICAgIH1cbiAgICAgIGNiKG51bGwsIHVybClcbiAgICB9KVxuICB9XG5cbiAgLy8gR2VuZXJhdGUgYSBwcmVzaWduZWQgVVJMIGZvciBHRVRcbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYG9iamVjdE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBvYmplY3RcbiAgLy8gKiBgZXhwaXJ5YCBfbnVtYmVyXzogZXhwaXJ5IGluIHNlY29uZHMgKG9wdGlvbmFsLCBkZWZhdWx0IDcgZGF5cylcbiAgLy8gKiBgcmVzcEhlYWRlcnNgIF9vYmplY3RfOiByZXNwb25zZSBoZWFkZXJzIHRvIG92ZXJyaWRlIG9yIHJlcXVlc3QgcGFyYW1zIGZvciBxdWVyeSAob3B0aW9uYWwpIGUuZyB7dmVyc2lvbklkOlwiMTBmYTk5NDYtM2Y2NC00MTM3LWE1OGYtODg4MDY1YzA3MzJlXCJ9XG4gIC8vICogYHJlcXVlc3REYXRlYCBfRGF0ZV86IEEgZGF0ZSBvYmplY3QsIHRoZSB1cmwgd2lsbCBiZSBpc3N1ZWQgYXQgKG9wdGlvbmFsKVxuICBwcmVzaWduZWRHZXRPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZXhwaXJlcywgcmVzcEhlYWRlcnMsIHJlcXVlc3REYXRlLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKGlzRnVuY3Rpb24ocmVzcEhlYWRlcnMpKSB7XG4gICAgICBjYiA9IHJlc3BIZWFkZXJzXG4gICAgICByZXNwSGVhZGVycyA9IHt9XG4gICAgICByZXF1ZXN0RGF0ZSA9IG5ldyBEYXRlKClcbiAgICB9XG5cbiAgICB2YXIgdmFsaWRSZXNwSGVhZGVycyA9IFtcbiAgICAgICdyZXNwb25zZS1jb250ZW50LXR5cGUnLFxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtbGFuZ3VhZ2UnLFxuICAgICAgJ3Jlc3BvbnNlLWV4cGlyZXMnLFxuICAgICAgJ3Jlc3BvbnNlLWNhY2hlLWNvbnRyb2wnLFxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtZGlzcG9zaXRpb24nLFxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtZW5jb2RpbmcnLFxuICAgIF1cbiAgICB2YWxpZFJlc3BIZWFkZXJzLmZvckVhY2goKGhlYWRlcikgPT4ge1xuICAgICAgaWYgKHJlc3BIZWFkZXJzICE9PSB1bmRlZmluZWQgJiYgcmVzcEhlYWRlcnNbaGVhZGVyXSAhPT0gdW5kZWZpbmVkICYmICFpc1N0cmluZyhyZXNwSGVhZGVyc1toZWFkZXJdKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGByZXNwb25zZSBoZWFkZXIgJHtoZWFkZXJ9IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCJgKVxuICAgICAgfVxuICAgIH0pXG4gICAgcmV0dXJuIHRoaXMucHJlc2lnbmVkVXJsKCdHRVQnLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBleHBpcmVzLCByZXNwSGVhZGVycywgcmVxdWVzdERhdGUsIGNiKVxuICB9XG5cbiAgLy8gR2VuZXJhdGUgYSBwcmVzaWduZWQgVVJMIGZvciBQVVQuIFVzaW5nIHRoaXMgVVJMLCB0aGUgYnJvd3NlciBjYW4gdXBsb2FkIHRvIFMzIG9ubHkgd2l0aCB0aGUgc3BlY2lmaWVkIG9iamVjdCBuYW1lLlxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgb2JqZWN0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBleHBpcnlgIF9udW1iZXJfOiBleHBpcnkgaW4gc2Vjb25kcyAob3B0aW9uYWwsIGRlZmF1bHQgNyBkYXlzKVxuICBwcmVzaWduZWRQdXRPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZXhwaXJlcywgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICByZXR1cm4gdGhpcy5wcmVzaWduZWRVcmwoJ1BVVCcsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGV4cGlyZXMsIGNiKVxuICB9XG5cbiAgLy8gcmV0dXJuIFBvc3RQb2xpY3kgb2JqZWN0XG4gIG5ld1Bvc3RQb2xpY3koKSB7XG4gICAgcmV0dXJuIG5ldyBQb3N0UG9saWN5KClcbiAgfVxuXG4gIC8vIHByZXNpZ25lZFBvc3RQb2xpY3kgY2FuIGJlIHVzZWQgaW4gc2l0dWF0aW9ucyB3aGVyZSB3ZSB3YW50IG1vcmUgY29udHJvbCBvbiB0aGUgdXBsb2FkIHRoYW4gd2hhdFxuICAvLyBwcmVzaWduZWRQdXRPYmplY3QoKSBwcm92aWRlcy4gaS5lIFVzaW5nIHByZXNpZ25lZFBvc3RQb2xpY3kgd2Ugd2lsbCBiZSBhYmxlIHRvIHB1dCBwb2xpY3kgcmVzdHJpY3Rpb25zXG4gIC8vIG9uIHRoZSBvYmplY3QncyBgbmFtZWAgYGJ1Y2tldGAgYGV4cGlyeWAgYENvbnRlbnQtVHlwZWAgYENvbnRlbnQtRGlzcG9zaXRpb25gIGBtZXRhRGF0YWBcbiAgcHJlc2lnbmVkUG9zdFBvbGljeShwb3N0UG9saWN5LCBjYikge1xuICAgIGlmICh0aGlzLmFub255bW91cykge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5Bbm9ueW1vdXNSZXF1ZXN0RXJyb3IoJ1ByZXNpZ25lZCBQT1NUIHBvbGljeSBjYW5ub3QgYmUgZ2VuZXJhdGVkIGZvciBhbm9ueW1vdXMgcmVxdWVzdHMnKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHBvc3RQb2xpY3kpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwb3N0UG9saWN5IHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYiBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICB0aGlzLmdldEJ1Y2tldFJlZ2lvbihwb3N0UG9saWN5LmZvcm1EYXRhLmJ1Y2tldCwgKGUsIHJlZ2lvbikgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG4gICAgICB2YXIgZGF0ZSA9IG5ldyBEYXRlKClcbiAgICAgIHZhciBkYXRlU3RyID0gbWFrZURhdGVMb25nKGRhdGUpXG5cbiAgICAgIHRoaXMuY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKVxuXG4gICAgICBpZiAoIXBvc3RQb2xpY3kucG9saWN5LmV4cGlyYXRpb24pIHtcbiAgICAgICAgLy8gJ2V4cGlyYXRpb24nIGlzIG1hbmRhdG9yeSBmaWVsZCBmb3IgUzMuXG4gICAgICAgIC8vIFNldCBkZWZhdWx0IGV4cGlyYXRpb24gZGF0ZSBvZiA3IGRheXMuXG4gICAgICAgIHZhciBleHBpcmVzID0gbmV3IERhdGUoKVxuICAgICAgICBleHBpcmVzLnNldFNlY29uZHMoMjQgKiA2MCAqIDYwICogNylcbiAgICAgICAgcG9zdFBvbGljeS5zZXRFeHBpcmVzKGV4cGlyZXMpXG4gICAgICB9XG5cbiAgICAgIHBvc3RQb2xpY3kucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ2VxJywgJyR4LWFtei1kYXRlJywgZGF0ZVN0cl0pXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1kYXRlJ10gPSBkYXRlU3RyXG5cbiAgICAgIHBvc3RQb2xpY3kucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ2VxJywgJyR4LWFtei1hbGdvcml0aG0nLCAnQVdTNC1ITUFDLVNIQTI1NiddKVxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotYWxnb3JpdGhtJ10gPSAnQVdTNC1ITUFDLVNIQTI1NidcblxuICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LWNyZWRlbnRpYWwnLCB0aGlzLmFjY2Vzc0tleSArICcvJyArIGdldFNjb3BlKHJlZ2lvbiwgZGF0ZSldKVxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotY3JlZGVudGlhbCddID0gdGhpcy5hY2Nlc3NLZXkgKyAnLycgKyBnZXRTY29wZShyZWdpb24sIGRhdGUpXG5cbiAgICAgIGlmICh0aGlzLnNlc3Npb25Ub2tlbikge1xuICAgICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotc2VjdXJpdHktdG9rZW4nLCB0aGlzLnNlc3Npb25Ub2tlbl0pXG4gICAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LXNlY3VyaXR5LXRva2VuJ10gPSB0aGlzLnNlc3Npb25Ub2tlblxuICAgICAgfVxuXG4gICAgICB2YXIgcG9saWN5QmFzZTY0ID0gQnVmZmVyLmZyb20oSlNPTi5zdHJpbmdpZnkocG9zdFBvbGljeS5wb2xpY3kpKS50b1N0cmluZygnYmFzZTY0JylcblxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YS5wb2xpY3kgPSBwb2xpY3lCYXNlNjRcblxuICAgICAgdmFyIHNpZ25hdHVyZSA9IHBvc3RQcmVzaWduU2lnbmF0dXJlVjQocmVnaW9uLCBkYXRlLCB0aGlzLnNlY3JldEtleSwgcG9saWN5QmFzZTY0KVxuXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1zaWduYXR1cmUnXSA9IHNpZ25hdHVyZVxuICAgICAgdmFyIG9wdHMgPSB7fVxuICAgICAgb3B0cy5yZWdpb24gPSByZWdpb25cbiAgICAgIG9wdHMuYnVja2V0TmFtZSA9IHBvc3RQb2xpY3kuZm9ybURhdGEuYnVja2V0XG4gICAgICB2YXIgcmVxT3B0aW9ucyA9IHRoaXMuZ2V0UmVxdWVzdE9wdGlvbnMob3B0cylcbiAgICAgIHZhciBwb3J0U3RyID0gdGhpcy5wb3J0ID09IDgwIHx8IHRoaXMucG9ydCA9PT0gNDQzID8gJycgOiBgOiR7dGhpcy5wb3J0LnRvU3RyaW5nKCl9YFxuICAgICAgdmFyIHVybFN0ciA9IGAke3JlcU9wdGlvbnMucHJvdG9jb2x9Ly8ke3JlcU9wdGlvbnMuaG9zdH0ke3BvcnRTdHJ9JHtyZXFPcHRpb25zLnBhdGh9YFxuICAgICAgY2IobnVsbCwgeyBwb3N0VVJMOiB1cmxTdHIsIGZvcm1EYXRhOiBwb3N0UG9saWN5LmZvcm1EYXRhIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8vIENvbXBsZXRlIHRoZSBtdWx0aXBhcnQgdXBsb2FkLiBBZnRlciBhbGwgdGhlIHBhcnRzIGFyZSB1cGxvYWRlZCBpc3N1aW5nXG4gIC8vIHRoaXMgY2FsbCB3aWxsIGFnZ3JlZ2F0ZSB0aGUgcGFydHMgb24gdGhlIHNlcnZlciBpbnRvIGEgc2luZ2xlIG9iamVjdC5cbiAgY29tcGxldGVNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdXBsb2FkSWQsIGV0YWdzLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcodXBsb2FkSWQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd1cGxvYWRJZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChldGFncykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2V0YWdzIHNob3VsZCBiZSBvZiB0eXBlIFwiQXJyYXlcIicpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NiIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuXG4gICAgaWYgKCF1cGxvYWRJZCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndXBsb2FkSWQgY2Fubm90IGJlIGVtcHR5JylcbiAgICB9XG5cbiAgICB2YXIgbWV0aG9kID0gJ1BPU1QnXG4gICAgdmFyIHF1ZXJ5ID0gYHVwbG9hZElkPSR7dXJpRXNjYXBlKHVwbG9hZElkKX1gXG5cbiAgICB2YXIgcGFydHMgPSBbXVxuXG4gICAgZXRhZ3MuZm9yRWFjaCgoZWxlbWVudCkgPT4ge1xuICAgICAgcGFydHMucHVzaCh7XG4gICAgICAgIFBhcnQ6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBQYXJ0TnVtYmVyOiBlbGVtZW50LnBhcnQsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBFVGFnOiBlbGVtZW50LmV0YWcsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgfSlcblxuICAgIHZhciBwYXlsb2FkT2JqZWN0ID0geyBDb21wbGV0ZU11bHRpcGFydFVwbG9hZDogcGFydHMgfVxuICAgIHZhciBwYXlsb2FkID0gWG1sKHBheWxvYWRPYmplY3QpXG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9LCBwYXlsb2FkLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG4gICAgICB2YXIgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMuZ2V0Q29tcGxldGVNdWx0aXBhcnRUcmFuc2Zvcm1lcigpXG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVyKVxuICAgICAgICAub24oJ2Vycm9yJywgKGUpID0+IGNiKGUpKVxuICAgICAgICAub24oJ2RhdGEnLCAocmVzdWx0KSA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdC5lcnJDb2RlKSB7XG4gICAgICAgICAgICAvLyBNdWx0aXBhcnQgQ29tcGxldGUgQVBJIHJldHVybnMgYW4gZXJyb3IgWE1MIGFmdGVyIGEgMjAwIGh0dHAgc3RhdHVzXG4gICAgICAgICAgICBjYihuZXcgZXJyb3JzLlMzRXJyb3IocmVzdWx0LmVyck1lc3NhZ2UpKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBjb21wbGV0ZU11bHRpcGFydFJlc3VsdCA9IHtcbiAgICAgICAgICAgICAgZXRhZzogcmVzdWx0LmV0YWcsXG4gICAgICAgICAgICAgIHZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlc3BvbnNlLmhlYWRlcnMpLFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2IobnVsbCwgY29tcGxldGVNdWx0aXBhcnRSZXN1bHQpXG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvLyBDYWxsZWQgYnkgbGlzdEluY29tcGxldGVVcGxvYWRzIHRvIGZldGNoIGEgYmF0Y2ggb2YgaW5jb21wbGV0ZSB1cGxvYWRzLlxuICBsaXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeShidWNrZXROYW1lLCBwcmVmaXgsIGtleU1hcmtlciwgdXBsb2FkSWRNYXJrZXIsIGRlbGltaXRlcikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGtleU1hcmtlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2tleU1hcmtlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyh1cGxvYWRJZE1hcmtlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VwbG9hZElkTWFya2VyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGRlbGltaXRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2RlbGltaXRlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgdmFyIHF1ZXJpZXMgPSBbXVxuICAgIHF1ZXJpZXMucHVzaChgcHJlZml4PSR7dXJpRXNjYXBlKHByZWZpeCl9YClcbiAgICBxdWVyaWVzLnB1c2goYGRlbGltaXRlcj0ke3VyaUVzY2FwZShkZWxpbWl0ZXIpfWApXG5cbiAgICBpZiAoa2V5TWFya2VyKSB7XG4gICAgICBrZXlNYXJrZXIgPSB1cmlFc2NhcGUoa2V5TWFya2VyKVxuICAgICAgcXVlcmllcy5wdXNoKGBrZXktbWFya2VyPSR7a2V5TWFya2VyfWApXG4gICAgfVxuICAgIGlmICh1cGxvYWRJZE1hcmtlcikge1xuICAgICAgcXVlcmllcy5wdXNoKGB1cGxvYWQtaWQtbWFya2VyPSR7dXBsb2FkSWRNYXJrZXJ9YClcbiAgICB9XG5cbiAgICB2YXIgbWF4VXBsb2FkcyA9IDEwMDBcbiAgICBxdWVyaWVzLnB1c2goYG1heC11cGxvYWRzPSR7bWF4VXBsb2Fkc31gKVxuICAgIHF1ZXJpZXMuc29ydCgpXG4gICAgcXVlcmllcy51bnNoaWZ0KCd1cGxvYWRzJylcbiAgICB2YXIgcXVlcnkgPSAnJ1xuICAgIGlmIChxdWVyaWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcmllcy5qb2luKCcmJyl9YFxuICAgIH1cbiAgICB2YXIgbWV0aG9kID0gJ0dFVCdcbiAgICB2YXIgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMuZ2V0TGlzdE11bHRpcGFydFRyYW5zZm9ybWVyKClcbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiB0cmFuc2Zvcm1lci5lbWl0KCdlcnJvcicsIGUpXG4gICAgICB9XG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVyKVxuICAgIH0pXG4gICAgcmV0dXJuIHRyYW5zZm9ybWVyXG4gIH1cblxuICAvLyBGaW5kIHVwbG9hZElkIG9mIGFuIGluY29tcGxldGUgdXBsb2FkLlxuICBmaW5kVXBsb2FkSWQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYiBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICB2YXIgbGF0ZXN0VXBsb2FkXG4gICAgdmFyIGxpc3ROZXh0ID0gKGtleU1hcmtlciwgdXBsb2FkSWRNYXJrZXIpID0+IHtcbiAgICAgIHRoaXMubGlzdEluY29tcGxldGVVcGxvYWRzUXVlcnkoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwga2V5TWFya2VyLCB1cGxvYWRJZE1hcmtlciwgJycpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gY2IoZSkpXG4gICAgICAgIC5vbignZGF0YScsIChyZXN1bHQpID0+IHtcbiAgICAgICAgICByZXN1bHQudXBsb2Fkcy5mb3JFYWNoKCh1cGxvYWQpID0+IHtcbiAgICAgICAgICAgIGlmICh1cGxvYWQua2V5ID09PSBvYmplY3ROYW1lKSB7XG4gICAgICAgICAgICAgIGlmICghbGF0ZXN0VXBsb2FkIHx8IHVwbG9hZC5pbml0aWF0ZWQuZ2V0VGltZSgpID4gbGF0ZXN0VXBsb2FkLmluaXRpYXRlZC5nZXRUaW1lKCkpIHtcbiAgICAgICAgICAgICAgICBsYXRlc3RVcGxvYWQgPSB1cGxvYWRcbiAgICAgICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xuICAgICAgICAgICAgbGlzdE5leHQocmVzdWx0Lm5leHRLZXlNYXJrZXIsIHJlc3VsdC5uZXh0VXBsb2FkSWRNYXJrZXIpXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGxhdGVzdFVwbG9hZCkge1xuICAgICAgICAgICAgcmV0dXJuIGNiKG51bGwsIGxhdGVzdFVwbG9hZC51cGxvYWRJZClcbiAgICAgICAgICB9XG4gICAgICAgICAgY2IobnVsbCwgdW5kZWZpbmVkKVxuICAgICAgICB9KVxuICAgIH1cbiAgICBsaXN0TmV4dCgnJywgJycpXG4gIH1cblxuICAvLyBSZW1vdmUgYWxsIHRoZSBub3RpZmljYXRpb24gY29uZmlndXJhdGlvbnMgaW4gdGhlIFMzIHByb3ZpZGVyXG4gIHNldEJ1Y2tldE5vdGlmaWNhdGlvbihidWNrZXROYW1lLCBjb25maWcsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChjb25maWcpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdub3RpZmljYXRpb24gY29uZmlnIHNob3VsZCBiZSBvZiB0eXBlIFwiT2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICB2YXIgbWV0aG9kID0gJ1BVVCdcbiAgICB2YXIgcXVlcnkgPSAnbm90aWZpY2F0aW9uJ1xuICAgIHZhciBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcbiAgICAgIHJvb3ROYW1lOiAnTm90aWZpY2F0aW9uQ29uZmlndXJhdGlvbicsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgIH0pXG4gICAgdmFyIHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KGNvbmZpZylcbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCBwYXlsb2FkLCBbMjAwXSwgJycsIGZhbHNlLCBjYilcbiAgfVxuXG4gIHJlbW92ZUFsbEJ1Y2tldE5vdGlmaWNhdGlvbihidWNrZXROYW1lLCBjYikge1xuICAgIHRoaXMuc2V0QnVja2V0Tm90aWZpY2F0aW9uKGJ1Y2tldE5hbWUsIG5ldyBOb3RpZmljYXRpb25Db25maWcoKSwgY2IpXG4gIH1cblxuICAvLyBSZXR1cm4gdGhlIGxpc3Qgb2Ygbm90aWZpY2F0aW9uIGNvbmZpZ3VyYXRpb25zIHN0b3JlZFxuICAvLyBpbiB0aGUgUzMgcHJvdmlkZXJcbiAgZ2V0QnVja2V0Tm90aWZpY2F0aW9uKGJ1Y2tldE5hbWUsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG4gICAgdmFyIG1ldGhvZCA9ICdHRVQnXG4gICAgdmFyIHF1ZXJ5ID0gJ25vdGlmaWNhdGlvbidcbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuICAgICAgdmFyIHRyYW5zZm9ybWVyID0gdHJhbnNmb3JtZXJzLmdldEJ1Y2tldE5vdGlmaWNhdGlvblRyYW5zZm9ybWVyKClcbiAgICAgIHZhciBidWNrZXROb3RpZmljYXRpb25cbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXIpXG4gICAgICAgIC5vbignZGF0YScsIChyZXN1bHQpID0+IChidWNrZXROb3RpZmljYXRpb24gPSByZXN1bHQpKVxuICAgICAgICAub24oJ2Vycm9yJywgKGUpID0+IGNiKGUpKVxuICAgICAgICAub24oJ2VuZCcsICgpID0+IGNiKG51bGwsIGJ1Y2tldE5vdGlmaWNhdGlvbikpXG4gICAgfSlcbiAgfVxuXG4gIC8vIExpc3RlbnMgZm9yIGJ1Y2tldCBub3RpZmljYXRpb25zLiBSZXR1cm5zIGFuIEV2ZW50RW1pdHRlci5cbiAgbGlzdGVuQnVja2V0Tm90aWZpY2F0aW9uKGJ1Y2tldE5hbWUsIHByZWZpeCwgc3VmZml4LCBldmVudHMpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBtdXN0IGJlIG9mIHR5cGUgc3RyaW5nJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhzdWZmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdWZmaXggbXVzdCBiZSBvZiB0eXBlIHN0cmluZycpXG4gICAgfVxuICAgIGlmICghQXJyYXkuaXNBcnJheShldmVudHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdldmVudHMgbXVzdCBiZSBvZiB0eXBlIEFycmF5JylcbiAgICB9XG4gICAgbGV0IGxpc3RlbmVyID0gbmV3IE5vdGlmaWNhdGlvblBvbGxlcih0aGlzLCBidWNrZXROYW1lLCBwcmVmaXgsIHN1ZmZpeCwgZXZlbnRzKVxuICAgIGxpc3RlbmVyLnN0YXJ0KClcblxuICAgIHJldHVybiBsaXN0ZW5lclxuICB9XG5cbiAgZ2V0QnVja2V0VmVyc2lvbmluZyhidWNrZXROYW1lLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIHZhciBtZXRob2QgPSAnR0VUJ1xuICAgIHZhciBxdWVyeSA9ICd2ZXJzaW9uaW5nJ1xuXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gY2IoZSlcbiAgICAgIH1cblxuICAgICAgbGV0IHZlcnNpb25Db25maWcgPSBCdWZmZXIuZnJvbSgnJylcbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXJzLmJ1Y2tldFZlcnNpb25pbmdUcmFuc2Zvcm1lcigpKVxuICAgICAgICAub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xuICAgICAgICAgIHZlcnNpb25Db25maWcgPSBkYXRhXG4gICAgICAgIH0pXG4gICAgICAgIC5vbignZXJyb3InLCBjYilcbiAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgY2IobnVsbCwgdmVyc2lvbkNvbmZpZylcbiAgICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgc2V0QnVja2V0VmVyc2lvbmluZyhidWNrZXROYW1lLCB2ZXJzaW9uQ29uZmlnLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghT2JqZWN0LmtleXModmVyc2lvbkNvbmZpZykubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd2ZXJzaW9uQ29uZmlnIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cblxuICAgIHZhciBtZXRob2QgPSAnUFVUJ1xuICAgIHZhciBxdWVyeSA9ICd2ZXJzaW9uaW5nJ1xuICAgIHZhciBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcbiAgICAgIHJvb3ROYW1lOiAnVmVyc2lvbmluZ0NvbmZpZ3VyYXRpb24nLFxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcbiAgICB9KVxuICAgIHZhciBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdCh2ZXJzaW9uQ29uZmlnKVxuXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgcGF5bG9hZCwgWzIwMF0sICcnLCBmYWxzZSwgY2IpXG4gIH1cblxuICAvKiogVG8gc2V0IFRhZ3Mgb24gYSBidWNrZXQgb3Igb2JqZWN0IGJhc2VkIG9uIHRoZSBwYXJhbXNcbiAgICogIF9fQXJndW1lbnRzX19cbiAgICogdGFnZ2luZ1BhcmFtcyBfb2JqZWN0XyBXaGljaCBjb250YWlucyB0aGUgZm9sbG93aW5nIHByb3BlcnRpZXNcbiAgICogIGJ1Y2tldE5hbWUgX3N0cmluZ18sXG4gICAqICBvYmplY3ROYW1lIF9zdHJpbmdfIChPcHRpb25hbCksXG4gICAqICB0YWdzIF9vYmplY3RfIG9mIHRoZSBmb3JtIHsnPHRhZy1rZXktMT4nOic8dGFnLXZhbHVlLTE+JywnPHRhZy1rZXktMj4nOic8dGFnLXZhbHVlLTI+J31cbiAgICogIHB1dE9wdHMgX29iamVjdF8gKE9wdGlvbmFsKSBlLmcge3ZlcnNpb25JZDpcIm15LW9iamVjdC12ZXJzaW9uLWlkXCJ9LFxuICAgKiAgY2IoZXJyb3IpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBgZXJyYCBhcyB0aGUgZXJyb3IgYXJndW1lbnQuIGBlcnJgIGlzIG51bGwgaWYgdGhlIG9wZXJhdGlvbiBpcyBzdWNjZXNzZnVsLlxuICAgKi9cbiAgc2V0VGFnZ2luZyh0YWdnaW5nUGFyYW1zKSB7XG4gICAgY29uc3QgeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCB0YWdzLCBwdXRPcHRzID0ge30sIGNiIH0gPSB0YWdnaW5nUGFyYW1zXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBsZXQgcXVlcnkgPSAndGFnZ2luZydcblxuICAgIGlmIChwdXRPcHRzICYmIHB1dE9wdHMudmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJ5fSZ2ZXJzaW9uSWQ9JHtwdXRPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuICAgIGNvbnN0IHRhZ3NMaXN0ID0gW11cbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyh0YWdzKSkge1xuICAgICAgdGFnc0xpc3QucHVzaCh7IEtleToga2V5LCBWYWx1ZTogdmFsdWUgfSlcbiAgICB9XG4gICAgY29uc3QgdGFnZ2luZ0NvbmZpZyA9IHtcbiAgICAgIFRhZ2dpbmc6IHtcbiAgICAgICAgVGFnU2V0OiB7XG4gICAgICAgICAgVGFnOiB0YWdzTGlzdCxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfVxuICAgIGNvbnN0IGVuY29kZXIgPSBuZXcgVGV4dEVuY29kZXIoKVxuICAgIGNvbnN0IGhlYWRlcnMgPSB7fVxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyBoZWFkbGVzczogdHJ1ZSwgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0gfSlcbiAgICBsZXQgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QodGFnZ2luZ0NvbmZpZylcbiAgICBwYXlsb2FkID0gQnVmZmVyLmZyb20oZW5jb2Rlci5lbmNvZGUocGF5bG9hZCkpXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIGhlYWRlcnMgfVxuXG4gICAgaWYgKG9iamVjdE5hbWUpIHtcbiAgICAgIHJlcXVlc3RPcHRpb25zWydvYmplY3ROYW1lJ10gPSBvYmplY3ROYW1lXG4gICAgfVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuXG4gICAgdGhpcy5tYWtlUmVxdWVzdChyZXF1ZXN0T3B0aW9ucywgcGF5bG9hZCwgWzIwMF0sICcnLCBmYWxzZSwgY2IpXG4gIH1cblxuICAvKiogU2V0IFRhZ3Mgb24gYSBCdWNrZXRcbiAgICogX19Bcmd1bWVudHNfX1xuICAgKiBidWNrZXROYW1lIF9zdHJpbmdfXG4gICAqIHRhZ3MgX29iamVjdF8gb2YgdGhlIGZvcm0geyc8dGFnLWtleS0xPic6Jzx0YWctdmFsdWUtMT4nLCc8dGFnLWtleS0yPic6Jzx0YWctdmFsdWUtMj4nfVxuICAgKiBgY2IoZXJyb3IpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBgZXJyYCBhcyB0aGUgZXJyb3IgYXJndW1lbnQuIGBlcnJgIGlzIG51bGwgaWYgdGhlIG9wZXJhdGlvbiBpcyBzdWNjZXNzZnVsLlxuICAgKi9cbiAgc2V0QnVja2V0VGFnZ2luZyhidWNrZXROYW1lLCB0YWdzLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QodGFncykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3RhZ3Mgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmIChPYmplY3Qua2V5cyh0YWdzKS5sZW5ndGggPiAxMCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignbWF4aW11bSB0YWdzIGFsbG93ZWQgaXMgMTBcIicpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuc2V0VGFnZ2luZyh7IGJ1Y2tldE5hbWUsIHRhZ3MsIGNiIH0pXG4gIH1cblxuICAvKiogU2V0IFRhZ3Mgb24gYW4gT2JqZWN0XG4gICAqIF9fQXJndW1lbnRzX19cbiAgICogYnVja2V0TmFtZSBfc3RyaW5nX1xuICAgKiBvYmplY3ROYW1lIF9zdHJpbmdfXG4gICAqICAqIHRhZ3MgX29iamVjdF8gb2YgdGhlIGZvcm0geyc8dGFnLWtleS0xPic6Jzx0YWctdmFsdWUtMT4nLCc8dGFnLWtleS0yPic6Jzx0YWctdmFsdWUtMj4nfVxuICAgKiAgcHV0T3B0cyBfb2JqZWN0XyAoT3B0aW9uYWwpIGUuZyB7dmVyc2lvbklkOlwibXktb2JqZWN0LXZlcnNpb24taWRcIn0sXG4gICAqIGBjYihlcnJvcilgIF9mdW5jdGlvbl8gLSBjYWxsYmFjayBmdW5jdGlvbiB3aXRoIGBlcnJgIGFzIHRoZSBlcnJvciBhcmd1bWVudC4gYGVycmAgaXMgbnVsbCBpZiB0aGUgb3BlcmF0aW9uIGlzIHN1Y2Nlc3NmdWwuXG4gICAqL1xuICBzZXRPYmplY3RUYWdnaW5nKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHRhZ3MsIHB1dE9wdHMgPSB7fSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgb2JqZWN0IG5hbWU6ICcgKyBvYmplY3ROYW1lKVxuICAgIH1cblxuICAgIGlmIChpc0Z1bmN0aW9uKHB1dE9wdHMpKSB7XG4gICAgICBjYiA9IHB1dE9wdHNcbiAgICAgIHB1dE9wdHMgPSB7fVxuICAgIH1cblxuICAgIGlmICghaXNPYmplY3QodGFncykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3RhZ3Mgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmIChPYmplY3Qua2V5cyh0YWdzKS5sZW5ndGggPiAxMCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignTWF4aW11bSB0YWdzIGFsbG93ZWQgaXMgMTBcIicpXG4gICAgfVxuXG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuc2V0VGFnZ2luZyh7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHRhZ3MsIHB1dE9wdHMsIGNiIH0pXG4gIH1cblxuICAvKiogUmVtb3ZlIFRhZ3Mgb24gYW4gQnVja2V0L09iamVjdCBiYXNlZCBvbiBwYXJhbXNcbiAgICogX19Bcmd1bWVudHNfX1xuICAgKiBidWNrZXROYW1lIF9zdHJpbmdfXG4gICAqIG9iamVjdE5hbWUgX3N0cmluZ18gKG9wdGlvbmFsKVxuICAgKiByZW1vdmVPcHRzIF9vYmplY3RfIChPcHRpb25hbCkgZS5nIHt2ZXJzaW9uSWQ6XCJteS1vYmplY3QtdmVyc2lvbi1pZFwifSxcbiAgICogYGNiKGVycm9yKWAgX2Z1bmN0aW9uXyAtIGNhbGxiYWNrIGZ1bmN0aW9uIHdpdGggYGVycmAgYXMgdGhlIGVycm9yIGFyZ3VtZW50LiBgZXJyYCBpcyBudWxsIGlmIHRoZSBvcGVyYXRpb24gaXMgc3VjY2Vzc2Z1bC5cbiAgICovXG4gIHJlbW92ZVRhZ2dpbmcoeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCByZW1vdmVPcHRzLCBjYiB9KSB7XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBsZXQgcXVlcnkgPSAndGFnZ2luZydcblxuICAgIGlmIChyZW1vdmVPcHRzICYmIE9iamVjdC5rZXlzKHJlbW92ZU9wdHMpLmxlbmd0aCAmJiByZW1vdmVPcHRzLnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyeX0mdmVyc2lvbklkPSR7cmVtb3ZlT3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9XG5cbiAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgcmVxdWVzdE9wdGlvbnNbJ29iamVjdE5hbWUnXSA9IG9iamVjdE5hbWVcbiAgICB9XG4gICAgdGhpcy5tYWtlUmVxdWVzdChyZXF1ZXN0T3B0aW9ucywgJycsIFsyMDAsIDIwNF0sICcnLCB0cnVlLCBjYilcbiAgfVxuXG4gIC8qKiBSZW1vdmUgVGFncyBhc3NvY2lhdGVkIHdpdGggYSBidWNrZXRcbiAgICogIF9fQXJndW1lbnRzX19cbiAgICogYnVja2V0TmFtZSBfc3RyaW5nX1xuICAgKiBgY2IoZXJyb3IpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBgZXJyYCBhcyB0aGUgZXJyb3IgYXJndW1lbnQuIGBlcnJgIGlzIG51bGwgaWYgdGhlIG9wZXJhdGlvbiBpcyBzdWNjZXNzZnVsLlxuICAgKi9cbiAgcmVtb3ZlQnVja2V0VGFnZ2luZyhidWNrZXROYW1lLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIHJldHVybiB0aGlzLnJlbW92ZVRhZ2dpbmcoeyBidWNrZXROYW1lLCBjYiB9KVxuICB9XG5cbiAgLyoqIFJlbW92ZSB0YWdzIGFzc29jaWF0ZWQgd2l0aCBhbiBvYmplY3RcbiAgICogX19Bcmd1bWVudHNfX1xuICAgKiBidWNrZXROYW1lIF9zdHJpbmdfXG4gICAqIG9iamVjdE5hbWUgX3N0cmluZ19cbiAgICogcmVtb3ZlT3B0cyBfb2JqZWN0XyAoT3B0aW9uYWwpIGUuZy4ge1ZlcnNpb25JRDpcIm15LW9iamVjdC12ZXJzaW9uLWlkXCJ9XG4gICAqIGBjYihlcnJvcilgIF9mdW5jdGlvbl8gLSBjYWxsYmFjayBmdW5jdGlvbiB3aXRoIGBlcnJgIGFzIHRoZSBlcnJvciBhcmd1bWVudC4gYGVycmAgaXMgbnVsbCBpZiB0aGUgb3BlcmF0aW9uIGlzIHN1Y2Nlc3NmdWwuXG4gICAqL1xuICByZW1vdmVPYmplY3RUYWdnaW5nKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHJlbW92ZU9wdHMsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIG9iamVjdCBuYW1lOiAnICsgb2JqZWN0TmFtZSlcbiAgICB9XG4gICAgaWYgKGlzRnVuY3Rpb24ocmVtb3ZlT3B0cykpIHtcbiAgICAgIGNiID0gcmVtb3ZlT3B0c1xuICAgICAgcmVtb3ZlT3B0cyA9IHt9XG4gICAgfVxuICAgIGlmIChyZW1vdmVPcHRzICYmIE9iamVjdC5rZXlzKHJlbW92ZU9wdHMpLmxlbmd0aCAmJiAhaXNPYmplY3QocmVtb3ZlT3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3JlbW92ZU9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5yZW1vdmVUYWdnaW5nKHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcmVtb3ZlT3B0cywgY2IgfSlcbiAgfVxuXG4gIC8qKiBHZXQgVGFncyBhc3NvY2lhdGVkIHdpdGggYSBCdWNrZXRcbiAgICogIF9fQXJndW1lbnRzX19cbiAgICogYnVja2V0TmFtZSBfc3RyaW5nX1xuICAgKiBgY2IoZXJyb3IsIHRhZ3MpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBgZXJyYCBhcyB0aGUgZXJyb3IgYXJndW1lbnQuIGBlcnJgIGlzIG51bGwgaWYgdGhlIG9wZXJhdGlvbiBpcyBzdWNjZXNzZnVsLlxuICAgKi9cbiAgZ2V0QnVja2V0VGFnZ2luZyhidWNrZXROYW1lLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICd0YWdnaW5nJ1xuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH1cblxuICAgIHRoaXMubWFrZVJlcXVlc3QocmVxdWVzdE9wdGlvbnMsICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgdmFyIHRyYW5zZm9ybWVyID0gdHJhbnNmb3JtZXJzLmdldFRhZ3NUcmFuc2Zvcm1lcigpXG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gY2IoZSlcbiAgICAgIH1cbiAgICAgIGxldCB0YWdzTGlzdFxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcilcbiAgICAgICAgLm9uKCdkYXRhJywgKHJlc3VsdCkgPT4gKHRhZ3NMaXN0ID0gcmVzdWx0KSlcbiAgICAgICAgLm9uKCdlcnJvcicsIChlKSA9PiBjYihlKSlcbiAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiBjYihudWxsLCB0YWdzTGlzdCkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKiBHZXQgdGhlIHRhZ3MgYXNzb2NpYXRlZCB3aXRoIGEgYnVja2V0IE9SIGFuIG9iamVjdFxuICAgKiBidWNrZXROYW1lIF9zdHJpbmdfXG4gICAqIG9iamVjdE5hbWUgX3N0cmluZ18gKE9wdGlvbmFsKVxuICAgKiBnZXRPcHRzIF9vYmplY3RfIChPcHRpb25hbCkgZS5nIHt2ZXJzaW9uSWQ6XCJteS1vYmplY3QtdmVyc2lvbi1pZFwifVxuICAgKiBgY2IoZXJyb3IsIHRhZ3MpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBgZXJyYCBhcyB0aGUgZXJyb3IgYXJndW1lbnQuIGBlcnJgIGlzIG51bGwgaWYgdGhlIG9wZXJhdGlvbiBpcyBzdWNjZXNzZnVsLlxuICAgKi9cbiAgZ2V0T2JqZWN0VGFnZ2luZyhidWNrZXROYW1lLCBvYmplY3ROYW1lLCBnZXRPcHRzID0ge30sIGNiID0gKCkgPT4gZmFsc2UpIHtcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGxldCBxdWVyeSA9ICd0YWdnaW5nJ1xuXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIG9iamVjdCBuYW1lOiAnICsgb2JqZWN0TmFtZSlcbiAgICB9XG4gICAgaWYgKGlzRnVuY3Rpb24oZ2V0T3B0cykpIHtcbiAgICAgIGNiID0gZ2V0T3B0c1xuICAgICAgZ2V0T3B0cyA9IHt9XG4gICAgfVxuICAgIGlmICghaXNPYmplY3QoZ2V0T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2dldE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuXG4gICAgaWYgKGdldE9wdHMgJiYgZ2V0T3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcnl9JnZlcnNpb25JZD0ke2dldE9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfVxuICAgIGlmIChvYmplY3ROYW1lKSB7XG4gICAgICByZXF1ZXN0T3B0aW9uc1snb2JqZWN0TmFtZSddID0gb2JqZWN0TmFtZVxuICAgIH1cblxuICAgIHRoaXMubWFrZVJlcXVlc3QocmVxdWVzdE9wdGlvbnMsICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgY29uc3QgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMuZ2V0VGFnc1RyYW5zZm9ybWVyKClcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuICAgICAgbGV0IHRhZ3NMaXN0XG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVyKVxuICAgICAgICAub24oJ2RhdGEnLCAocmVzdWx0KSA9PiAodGFnc0xpc3QgPSByZXN1bHQpKVxuICAgICAgICAub24oJ2Vycm9yJywgKGUpID0+IGNiKGUpKVxuICAgICAgICAub24oJ2VuZCcsICgpID0+IGNiKG51bGwsIHRhZ3NMaXN0KSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGx5IGxpZmVjeWNsZSBjb25maWd1cmF0aW9uIG9uIGEgYnVja2V0LlxuICAgKiBidWNrZXROYW1lIF9zdHJpbmdfXG4gICAqIHBvbGljeUNvbmZpZyBfb2JqZWN0XyBhIHZhbGlkIHBvbGljeSBjb25maWd1cmF0aW9uIG9iamVjdC5cbiAgICogYGNiKGVycm9yKWAgX2Z1bmN0aW9uXyAtIGNhbGxiYWNrIGZ1bmN0aW9uIHdpdGggYGVycmAgYXMgdGhlIGVycm9yIGFyZ3VtZW50LiBgZXJyYCBpcyBudWxsIGlmIHRoZSBvcGVyYXRpb24gaXMgc3VjY2Vzc2Z1bC5cbiAgICovXG4gIGFwcGx5QnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWUsIHBvbGljeUNvbmZpZywgY2IpIHtcbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2xpZmVjeWNsZSdcblxuICAgIGNvbnN0IGVuY29kZXIgPSBuZXcgVGV4dEVuY29kZXIoKVxuICAgIGNvbnN0IGhlYWRlcnMgPSB7fVxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdMaWZlY3ljbGVDb25maWd1cmF0aW9uJyxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXG4gICAgfSlcbiAgICBsZXQgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QocG9saWN5Q29uZmlnKVxuICAgIHBheWxvYWQgPSBCdWZmZXIuZnJvbShlbmNvZGVyLmVuY29kZShwYXlsb2FkKSlcbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9XG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHJlcXVlc3RPcHRpb25zLCBwYXlsb2FkLCBbMjAwXSwgJycsIGZhbHNlLCBjYilcbiAgfVxuXG4gIC8qKiBSZW1vdmUgbGlmZWN5Y2xlIGNvbmZpZ3VyYXRpb24gb2YgYSBidWNrZXQuXG4gICAqIGJ1Y2tldE5hbWUgX3N0cmluZ19cbiAgICogYGNiKGVycm9yKWAgX2Z1bmN0aW9uXyAtIGNhbGxiYWNrIGZ1bmN0aW9uIHdpdGggYGVycmAgYXMgdGhlIGVycm9yIGFyZ3VtZW50LiBgZXJyYCBpcyBudWxsIGlmIHRoZSBvcGVyYXRpb24gaXMgc3VjY2Vzc2Z1bC5cbiAgICovXG4gIHJlbW92ZUJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgY29uc3QgcXVlcnkgPSAnbGlmZWN5Y2xlJ1xuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjA0XSwgJycsIGZhbHNlLCBjYilcbiAgfVxuXG4gIC8qKiBTZXQvT3ZlcnJpZGUgbGlmZWN5Y2xlIGNvbmZpZ3VyYXRpb24gb24gYSBidWNrZXQuIGlmIHRoZSBjb25maWd1cmF0aW9uIGlzIGVtcHR5LCBpdCByZW1vdmVzIHRoZSBjb25maWd1cmF0aW9uLlxuICAgKiBidWNrZXROYW1lIF9zdHJpbmdfXG4gICAqIGxpZmVDeWNsZUNvbmZpZyBfb2JqZWN0XyBvbmUgb2YgdGhlIGZvbGxvd2luZyB2YWx1ZXM6IChudWxsIG9yICcnKSB0byByZW1vdmUgdGhlIGxpZmVjeWNsZSBjb25maWd1cmF0aW9uLiBvciBhIHZhbGlkIGxpZmVjeWNsZSBjb25maWd1cmF0aW9uXG4gICAqIGBjYihlcnJvcilgIF9mdW5jdGlvbl8gLSBjYWxsYmFjayBmdW5jdGlvbiB3aXRoIGBlcnJgIGFzIHRoZSBlcnJvciBhcmd1bWVudC4gYGVycmAgaXMgbnVsbCBpZiB0aGUgb3BlcmF0aW9uIGlzIHN1Y2Nlc3NmdWwuXG4gICAqL1xuICBzZXRCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZSwgbGlmZUN5Y2xlQ29uZmlnID0gbnVsbCwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoXy5pc0VtcHR5KGxpZmVDeWNsZUNvbmZpZykpIHtcbiAgICAgIHRoaXMucmVtb3ZlQnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWUsIGNiKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmFwcGx5QnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWUsIGxpZmVDeWNsZUNvbmZpZywgY2IpXG4gICAgfVxuICB9XG5cbiAgLyoqIEdldCBsaWZlY3ljbGUgY29uZmlndXJhdGlvbiBvbiBhIGJ1Y2tldC5cbiAgICogYnVja2V0TmFtZSBfc3RyaW5nX1xuICAgKiBgY2IoY29uZmlnKWAgX2Z1bmN0aW9uXyAtIGNhbGxiYWNrIGZ1bmN0aW9uIHdpdGggbGlmZWN5Y2xlIGNvbmZpZ3VyYXRpb24gYXMgdGhlIGVycm9yIGFyZ3VtZW50LlxuICAgKi9cbiAgZ2V0QnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWUsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICdsaWZlY3ljbGUnXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfVxuXG4gICAgdGhpcy5tYWtlUmVxdWVzdChyZXF1ZXN0T3B0aW9ucywgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICBjb25zdCB0cmFuc2Zvcm1lciA9IHRyYW5zZm9ybWVycy5saWZlY3ljbGVUcmFuc2Zvcm1lcigpXG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gY2IoZSlcbiAgICAgIH1cbiAgICAgIGxldCBsaWZlY3ljbGVDb25maWdcbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXIpXG4gICAgICAgIC5vbignZGF0YScsIChyZXN1bHQpID0+IChsaWZlY3ljbGVDb25maWcgPSByZXN1bHQpKVxuICAgICAgICAub24oJ2Vycm9yJywgKGUpID0+IGNiKGUpKVxuICAgICAgICAub24oJ2VuZCcsICgpID0+IGNiKG51bGwsIGxpZmVjeWNsZUNvbmZpZykpXG4gICAgfSlcbiAgfVxuXG4gIHNldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZSwgbG9ja0NvbmZpZ09wdHMgPSB7fSwgY2IpIHtcbiAgICBjb25zdCByZXRlbnRpb25Nb2RlcyA9IFtSRVRFTlRJT05fTU9ERVMuQ09NUExJQU5DRSwgUkVURU5USU9OX01PREVTLkdPVkVSTkFOQ0VdXG4gICAgY29uc3QgdmFsaWRVbml0cyA9IFtSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuREFZUywgUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLllFQVJTXVxuXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG5cbiAgICBpZiAobG9ja0NvbmZpZ09wdHMubW9kZSAmJiAhcmV0ZW50aW9uTW9kZXMuaW5jbHVkZXMobG9ja0NvbmZpZ09wdHMubW9kZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGxvY2tDb25maWdPcHRzLm1vZGUgc2hvdWxkIGJlIG9uZSBvZiAke3JldGVudGlvbk1vZGVzfWApXG4gICAgfVxuICAgIGlmIChsb2NrQ29uZmlnT3B0cy51bml0ICYmICF2YWxpZFVuaXRzLmluY2x1ZGVzKGxvY2tDb25maWdPcHRzLnVuaXQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBsb2NrQ29uZmlnT3B0cy51bml0IHNob3VsZCBiZSBvbmUgb2YgJHt2YWxpZFVuaXRzfWApXG4gICAgfVxuICAgIGlmIChsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSAmJiAhaXNOdW1iZXIobG9ja0NvbmZpZ09wdHMudmFsaWRpdHkpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSBzaG91bGQgYmUgYSBudW1iZXJgKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSAnb2JqZWN0LWxvY2snXG5cbiAgICBsZXQgY29uZmlnID0ge1xuICAgICAgT2JqZWN0TG9ja0VuYWJsZWQ6ICdFbmFibGVkJyxcbiAgICB9XG4gICAgY29uc3QgY29uZmlnS2V5cyA9IE9iamVjdC5rZXlzKGxvY2tDb25maWdPcHRzKVxuICAgIC8vIENoZWNrIGlmIGtleXMgYXJlIHByZXNlbnQgYW5kIGFsbCBrZXlzIGFyZSBwcmVzZW50LlxuICAgIGlmIChjb25maWdLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIGlmIChfLmRpZmZlcmVuY2UoY29uZmlnS2V5cywgWyd1bml0JywgJ21vZGUnLCAndmFsaWRpdHknXSkubGVuZ3RoICE9PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgYGxvY2tDb25maWdPcHRzLm1vZGUsbG9ja0NvbmZpZ09wdHMudW5pdCxsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSBhbGwgdGhlIHByb3BlcnRpZXMgc2hvdWxkIGJlIHNwZWNpZmllZC5gLFxuICAgICAgICApXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25maWcuUnVsZSA9IHtcbiAgICAgICAgICBEZWZhdWx0UmV0ZW50aW9uOiB7fSxcbiAgICAgICAgfVxuICAgICAgICBpZiAobG9ja0NvbmZpZ09wdHMubW9kZSkge1xuICAgICAgICAgIGNvbmZpZy5SdWxlLkRlZmF1bHRSZXRlbnRpb24uTW9kZSA9IGxvY2tDb25maWdPcHRzLm1vZGVcbiAgICAgICAgfVxuICAgICAgICBpZiAobG9ja0NvbmZpZ09wdHMudW5pdCA9PT0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLkRBWVMpIHtcbiAgICAgICAgICBjb25maWcuUnVsZS5EZWZhdWx0UmV0ZW50aW9uLkRheXMgPSBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eVxuICAgICAgICB9IGVsc2UgaWYgKGxvY2tDb25maWdPcHRzLnVuaXQgPT09IFJFVEVOVElPTl9WQUxJRElUWV9VTklUUy5ZRUFSUykge1xuICAgICAgICAgIGNvbmZpZy5SdWxlLkRlZmF1bHRSZXRlbnRpb24uWWVhcnMgPSBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ09iamVjdExvY2tDb25maWd1cmF0aW9uJyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChjb25maWcpXG5cbiAgICBjb25zdCBoZWFkZXJzID0ge31cbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQsIFsyMDBdLCAnJywgZmFsc2UsIGNiKVxuICB9XG5cbiAgZ2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAnb2JqZWN0LWxvY2snXG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuXG4gICAgICBsZXQgb2JqZWN0TG9ja0NvbmZpZyA9IEJ1ZmZlci5mcm9tKCcnKVxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcnMub2JqZWN0TG9ja1RyYW5zZm9ybWVyKCkpXG4gICAgICAgIC5vbignZGF0YScsIChkYXRhKSA9PiB7XG4gICAgICAgICAgb2JqZWN0TG9ja0NvbmZpZyA9IGRhdGFcbiAgICAgICAgfSlcbiAgICAgICAgLm9uKCdlcnJvcicsIGNiKVxuICAgICAgICAub24oJ2VuZCcsICgpID0+IHtcbiAgICAgICAgICBjYihudWxsLCBvYmplY3RMb2NrQ29uZmlnKVxuICAgICAgICB9KVxuICAgIH0pXG4gIH1cblxuICBwdXRPYmplY3RSZXRlbnRpb24oYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcmV0ZW50aW9uT3B0cyA9IHt9LCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QocmV0ZW50aW9uT3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3JldGVudGlvbk9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChyZXRlbnRpb25PcHRzLmdvdmVybmFuY2VCeXBhc3MgJiYgIWlzQm9vbGVhbihyZXRlbnRpb25PcHRzLmdvdmVybmFuY2VCeXBhc3MpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0ludmFsaWQgdmFsdWUgZm9yIGdvdmVybmFuY2VCeXBhc3MnLCByZXRlbnRpb25PcHRzLmdvdmVybmFuY2VCeXBhc3MpXG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgIHJldGVudGlvbk9wdHMubW9kZSAmJlxuICAgICAgICAhW1JFVEVOVElPTl9NT0RFUy5DT01QTElBTkNFLCBSRVRFTlRJT05fTU9ERVMuR09WRVJOQU5DRV0uaW5jbHVkZXMocmV0ZW50aW9uT3B0cy5tb2RlKVxuICAgICAgKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0ludmFsaWQgb2JqZWN0IHJldGVudGlvbiBtb2RlICcsIHJldGVudGlvbk9wdHMubW9kZSlcbiAgICAgIH1cbiAgICAgIGlmIChyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZSAmJiAhaXNTdHJpbmcocmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0ludmFsaWQgdmFsdWUgZm9yIHJldGFpblVudGlsRGF0ZScsIHJldGVudGlvbk9wdHMucmV0YWluVW50aWxEYXRlKVxuICAgICAgfVxuICAgICAgaWYgKHJldGVudGlvbk9wdHMudmVyc2lvbklkICYmICFpc1N0cmluZyhyZXRlbnRpb25PcHRzLnZlcnNpb25JZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW52YWxpZCB2YWx1ZSBmb3IgdmVyc2lvbklkJywgcmV0ZW50aW9uT3B0cy52ZXJzaW9uSWQpXG4gICAgICB9XG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBsZXQgcXVlcnkgPSAncmV0ZW50aW9uJ1xuXG4gICAgY29uc3QgaGVhZGVycyA9IHt9XG4gICAgaWYgKHJldGVudGlvbk9wdHMuZ292ZXJuYW5jZUJ5cGFzcykge1xuICAgICAgaGVhZGVyc1snWC1BbXotQnlwYXNzLUdvdmVybmFuY2UtUmV0ZW50aW9uJ10gPSB0cnVlXG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IHJvb3ROYW1lOiAnUmV0ZW50aW9uJywgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sIGhlYWRsZXNzOiB0cnVlIH0pXG4gICAgY29uc3QgcGFyYW1zID0ge31cblxuICAgIGlmIChyZXRlbnRpb25PcHRzLm1vZGUpIHtcbiAgICAgIHBhcmFtcy5Nb2RlID0gcmV0ZW50aW9uT3B0cy5tb2RlXG4gICAgfVxuICAgIGlmIChyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZSkge1xuICAgICAgcGFyYW1zLlJldGFpblVudGlsRGF0ZSA9IHJldGVudGlvbk9wdHMucmV0YWluVW50aWxEYXRlXG4gICAgfVxuICAgIGlmIChyZXRlbnRpb25PcHRzLnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgKz0gYCZ2ZXJzaW9uSWQ9JHtyZXRlbnRpb25PcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuXG4gICAgbGV0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHBhcmFtcylcblxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQsIFsyMDAsIDIwNF0sICcnLCBmYWxzZSwgY2IpXG4gIH1cblxuICBnZXRPYmplY3RSZXRlbnRpb24oYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZ2V0T3B0cywgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGdldE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9IGVsc2UgaWYgKGdldE9wdHMudmVyc2lvbklkICYmICFpc1N0cmluZyhnZXRPcHRzLnZlcnNpb25JZCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ1ZlcnNpb25JRCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKGNiICYmICFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBsZXQgcXVlcnkgPSAncmV0ZW50aW9uJ1xuICAgIGlmIChnZXRPcHRzLnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgKz0gYCZ2ZXJzaW9uSWQ9JHtnZXRPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gY2IoZSlcbiAgICAgIH1cblxuICAgICAgbGV0IHJldGVudGlvbkNvbmZpZyA9IEJ1ZmZlci5mcm9tKCcnKVxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcnMub2JqZWN0UmV0ZW50aW9uVHJhbnNmb3JtZXIoKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICAgICAgICByZXRlbnRpb25Db25maWcgPSBkYXRhXG4gICAgICAgIH0pXG4gICAgICAgIC5vbignZXJyb3InLCBjYilcbiAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgY2IobnVsbCwgcmV0ZW50aW9uQ29uZmlnKVxuICAgICAgICB9KVxuICAgIH0pXG4gIH1cblxuICBzZXRCdWNrZXRFbmNyeXB0aW9uKGJ1Y2tldE5hbWUsIGVuY3J5cHRpb25Db25maWcsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG5cbiAgICBpZiAoaXNGdW5jdGlvbihlbmNyeXB0aW9uQ29uZmlnKSkge1xuICAgICAgY2IgPSBlbmNyeXB0aW9uQ29uZmlnXG4gICAgICBlbmNyeXB0aW9uQ29uZmlnID0gbnVsbFxuICAgIH1cblxuICAgIGlmICghXy5pc0VtcHR5KGVuY3J5cHRpb25Db25maWcpICYmIGVuY3J5cHRpb25Db25maWcuUnVsZS5sZW5ndGggPiAxKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdJbnZhbGlkIFJ1bGUgbGVuZ3RoLiBPbmx5IG9uZSBydWxlIGlzIGFsbG93ZWQuOiAnICsgZW5jcnlwdGlvbkNvbmZpZy5SdWxlKVxuICAgIH1cbiAgICBpZiAoY2IgJiYgIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cblxuICAgIGxldCBlbmNyeXB0aW9uT2JqID0gZW5jcnlwdGlvbkNvbmZpZ1xuICAgIGlmIChfLmlzRW1wdHkoZW5jcnlwdGlvbkNvbmZpZykpIHtcbiAgICAgIGVuY3J5cHRpb25PYmogPSB7XG4gICAgICAgIC8vIERlZmF1bHQgTWluSU8gU2VydmVyIFN1cHBvcnRlZCBSdWxlXG4gICAgICAgIFJ1bGU6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBBcHBseVNlcnZlclNpZGVFbmNyeXB0aW9uQnlEZWZhdWx0OiB7XG4gICAgICAgICAgICAgIFNTRUFsZ29yaXRobTogJ0FFUzI1NicsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IG1ldGhvZCA9ICdQVVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ2VuY3J5cHRpb24nXG4gICAgbGV0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdTZXJ2ZXJTaWRlRW5jcnlwdGlvbkNvbmZpZ3VyYXRpb24nLFxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcbiAgICB9KVxuICAgIGxldCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChlbmNyeXB0aW9uT2JqKVxuXG4gICAgY29uc3QgaGVhZGVycyA9IHt9XG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkLCBbMjAwXSwgJycsIGZhbHNlLCBjYilcbiAgfVxuXG4gIGdldEJ1Y2tldEVuY3J5cHRpb24oYnVja2V0TmFtZSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2VuY3J5cHRpb24nXG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuXG4gICAgICBsZXQgYnVja2V0RW5jQ29uZmlnID0gQnVmZmVyLmZyb20oJycpXG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVycy5idWNrZXRFbmNyeXB0aW9uVHJhbnNmb3JtZXIoKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICAgICAgICBidWNrZXRFbmNDb25maWcgPSBkYXRhXG4gICAgICAgIH0pXG4gICAgICAgIC5vbignZXJyb3InLCBjYilcbiAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgY2IobnVsbCwgYnVja2V0RW5jQ29uZmlnKVxuICAgICAgICB9KVxuICAgIH0pXG4gIH1cbiAgcmVtb3ZlQnVja2V0RW5jcnlwdGlvbihidWNrZXROYW1lLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgY29uc3QgcXVlcnkgPSAnZW5jcnlwdGlvbidcblxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjA0XSwgJycsIGZhbHNlLCBjYilcbiAgfVxuXG4gIGdldE9iamVjdExlZ2FsSG9sZChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBnZXRPcHRzID0ge30sIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoaXNGdW5jdGlvbihnZXRPcHRzKSkge1xuICAgICAgY2IgPSBnZXRPcHRzXG4gICAgICBnZXRPcHRzID0ge31cbiAgICB9XG5cbiAgICBpZiAoIWlzT2JqZWN0KGdldE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdnZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwiT2JqZWN0XCInKVxuICAgIH0gZWxzZSBpZiAoT2JqZWN0LmtleXMoZ2V0T3B0cykubGVuZ3RoID4gMCAmJiBnZXRPcHRzLnZlcnNpb25JZCAmJiAhaXNTdHJpbmcoZ2V0T3B0cy52ZXJzaW9uSWQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2ZXJzaW9uSWQgc2hvdWxkIGJlIG9mIHR5cGUgc3RyaW5nLjonLCBnZXRPcHRzLnZlcnNpb25JZClcbiAgICB9XG5cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ2xlZ2FsLWhvbGQnXG5cbiAgICBpZiAoZ2V0T3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7Z2V0T3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cblxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG5cbiAgICAgIGxldCBsZWdhbEhvbGRDb25maWcgPSBCdWZmZXIuZnJvbSgnJylcbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXJzLm9iamVjdExlZ2FsSG9sZFRyYW5zZm9ybWVyKCkpXG4gICAgICAgIC5vbignZGF0YScsIChkYXRhKSA9PiB7XG4gICAgICAgICAgbGVnYWxIb2xkQ29uZmlnID0gZGF0YVxuICAgICAgICB9KVxuICAgICAgICAub24oJ2Vycm9yJywgY2IpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4ge1xuICAgICAgICAgIGNiKG51bGwsIGxlZ2FsSG9sZENvbmZpZylcbiAgICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgc2V0T2JqZWN0TGVnYWxIb2xkKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHNldE9wdHMgPSB7fSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IGRlZmF1bHRPcHRzID0ge1xuICAgICAgc3RhdHVzOiBMRUdBTF9IT0xEX1NUQVRVUy5FTkFCTEVELFxuICAgIH1cbiAgICBpZiAoaXNGdW5jdGlvbihzZXRPcHRzKSkge1xuICAgICAgY2IgPSBzZXRPcHRzXG4gICAgICBzZXRPcHRzID0gZGVmYXVsdE9wdHNcbiAgICB9XG5cbiAgICBpZiAoIWlzT2JqZWN0KHNldE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwiT2JqZWN0XCInKVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIVtMRUdBTF9IT0xEX1NUQVRVUy5FTkFCTEVELCBMRUdBTF9IT0xEX1NUQVRVUy5ESVNBQkxFRF0uaW5jbHVkZXMoc2V0T3B0cy5zdGF0dXMpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0ludmFsaWQgc3RhdHVzOiAnICsgc2V0T3B0cy5zdGF0dXMpXG4gICAgICB9XG4gICAgICBpZiAoc2V0T3B0cy52ZXJzaW9uSWQgJiYgIXNldE9wdHMudmVyc2lvbklkLmxlbmd0aCkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2ZXJzaW9uSWQgc2hvdWxkIGJlIG9mIHR5cGUgc3RyaW5nLjonICsgc2V0T3B0cy52ZXJzaW9uSWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICBpZiAoXy5pc0VtcHR5KHNldE9wdHMpKSB7XG4gICAgICBzZXRPcHRzID0ge1xuICAgICAgICBkZWZhdWx0T3B0cyxcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGxldCBxdWVyeSA9ICdsZWdhbC1ob2xkJ1xuXG4gICAgaWYgKHNldE9wdHMudmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSArPSBgJnZlcnNpb25JZD0ke3NldE9wdHMudmVyc2lvbklkfWBcbiAgICB9XG5cbiAgICBsZXQgY29uZmlnID0ge1xuICAgICAgU3RhdHVzOiBzZXRPcHRzLnN0YXR1cyxcbiAgICB9XG5cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHsgcm9vdE5hbWU6ICdMZWdhbEhvbGQnLCByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSwgaGVhZGxlc3M6IHRydWUgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChjb25maWcpXG4gICAgY29uc3QgaGVhZGVycyA9IHt9XG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkLCBbMjAwXSwgJycsIGZhbHNlLCBjYilcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBtZXRob2QgdG8gdXBsb2FkIGEgcGFydCBkdXJpbmcgY29tcG9zZSBvYmplY3QuXG4gICAqIEBwYXJhbSBwYXJ0Q29uZmlnIF9fb2JqZWN0X18gY29udGFpbnMgdGhlIGZvbGxvd2luZy5cbiAgICogICAgYnVja2V0TmFtZSBfX3N0cmluZ19fXG4gICAqICAgIG9iamVjdE5hbWUgX19zdHJpbmdfX1xuICAgKiAgICB1cGxvYWRJRCBfX3N0cmluZ19fXG4gICAqICAgIHBhcnROdW1iZXIgX19udW1iZXJfX1xuICAgKiAgICBoZWFkZXJzIF9fb2JqZWN0X19cbiAgICogQHBhcmFtIGNiIGNhbGxlZCB3aXRoIG51bGwgaW5jYXNlIG9mIGVycm9yLlxuICAgKi9cbiAgdXBsb2FkUGFydENvcHkocGFydENvbmZpZywgY2IpIHtcbiAgICBjb25zdCB7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHVwbG9hZElELCBwYXJ0TnVtYmVyLCBoZWFkZXJzIH0gPSBwYXJ0Q29uZmlnXG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGxldCBxdWVyeSA9IGB1cGxvYWRJZD0ke3VwbG9hZElEfSZwYXJ0TnVtYmVyPSR7cGFydE51bWJlcn1gXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZTogb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfVxuICAgIHJldHVybiB0aGlzLm1ha2VSZXF1ZXN0KHJlcXVlc3RPcHRpb25zLCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGxldCBwYXJ0Q29weVJlc3VsdCA9IEJ1ZmZlci5mcm9tKCcnKVxuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVycy51cGxvYWRQYXJ0VHJhbnNmb3JtZXIoKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICAgICAgICBwYXJ0Q29weVJlc3VsdCA9IGRhdGFcbiAgICAgICAgfSlcbiAgICAgICAgLm9uKCdlcnJvcicsIGNiKVxuICAgICAgICAub24oJ2VuZCcsICgpID0+IHtcbiAgICAgICAgICBsZXQgdXBsb2FkUGFydENvcHlSZXMgPSB7XG4gICAgICAgICAgICBldGFnOiBzYW5pdGl6ZUVUYWcocGFydENvcHlSZXN1bHQuRVRhZyksXG4gICAgICAgICAgICBrZXk6IG9iamVjdE5hbWUsXG4gICAgICAgICAgICBwYXJ0OiBwYXJ0TnVtYmVyLFxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNiKG51bGwsIHVwbG9hZFBhcnRDb3B5UmVzKVxuICAgICAgICB9KVxuICAgIH0pXG4gIH1cblxuICBjb21wb3NlT2JqZWN0KGRlc3RPYmpDb25maWcgPSB7fSwgc291cmNlT2JqTGlzdCA9IFtdLCBjYikge1xuICAgIGNvbnN0IG1lID0gdGhpcyAvLyBtYW55IGFzeW5jIGZsb3dzLiBzbyBzdG9yZSB0aGUgcmVmLlxuICAgIGNvbnN0IHNvdXJjZUZpbGVzTGVuZ3RoID0gc291cmNlT2JqTGlzdC5sZW5ndGhcblxuICAgIGlmICghQXJyYXkuaXNBcnJheShzb3VyY2VPYmpMaXN0KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignc291cmNlQ29uZmlnIHNob3VsZCBhbiBhcnJheSBvZiBDb3B5U291cmNlT3B0aW9ucyAnKVxuICAgIH1cbiAgICBpZiAoIShkZXN0T2JqQ29uZmlnIGluc3RhbmNlb2YgQ29weURlc3RpbmF0aW9uT3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2Rlc3RDb25maWcgc2hvdWxkIG9mIHR5cGUgQ29weURlc3RpbmF0aW9uT3B0aW9ucyAnKVxuICAgIH1cblxuICAgIGlmIChzb3VyY2VGaWxlc0xlbmd0aCA8IDEgfHwgc291cmNlRmlsZXNMZW5ndGggPiBQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgYFwiVGhlcmUgbXVzdCBiZSBhcyBsZWFzdCBvbmUgYW5kIHVwIHRvICR7UEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVFNfQ09VTlR9IHNvdXJjZSBvYmplY3RzLmAsXG4gICAgICApXG4gICAgfVxuXG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNvdXJjZUZpbGVzTGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmICghc291cmNlT2JqTGlzdFtpXS52YWxpZGF0ZSgpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghZGVzdE9iakNvbmZpZy52YWxpZGF0ZSgpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICBjb25zdCBnZXRTdGF0T3B0aW9ucyA9IChzcmNDb25maWcpID0+IHtcbiAgICAgIGxldCBzdGF0T3B0cyA9IHt9XG4gICAgICBpZiAoIV8uaXNFbXB0eShzcmNDb25maWcuVmVyc2lvbklEKSkge1xuICAgICAgICBzdGF0T3B0cyA9IHtcbiAgICAgICAgICB2ZXJzaW9uSWQ6IHNyY0NvbmZpZy5WZXJzaW9uSUQsXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBzdGF0T3B0c1xuICAgIH1cbiAgICBjb25zdCBzcmNPYmplY3RTaXplcyA9IFtdXG4gICAgbGV0IHRvdGFsU2l6ZSA9IDBcbiAgICBsZXQgdG90YWxQYXJ0cyA9IDBcblxuICAgIGNvbnN0IHNvdXJjZU9ialN0YXRzID0gc291cmNlT2JqTGlzdC5tYXAoKHNyY0l0ZW0pID0+XG4gICAgICBtZS5zdGF0T2JqZWN0KHNyY0l0ZW0uQnVja2V0LCBzcmNJdGVtLk9iamVjdCwgZ2V0U3RhdE9wdGlvbnMoc3JjSXRlbSkpLFxuICAgIClcblxuICAgIHJldHVybiBQcm9taXNlLmFsbChzb3VyY2VPYmpTdGF0cylcbiAgICAgIC50aGVuKChzcmNPYmplY3RJbmZvcykgPT4ge1xuICAgICAgICBjb25zdCB2YWxpZGF0ZWRTdGF0cyA9IHNyY09iamVjdEluZm9zLm1hcCgocmVzSXRlbVN0YXQsIGluZGV4KSA9PiB7XG4gICAgICAgICAgY29uc3Qgc3JjQ29uZmlnID0gc291cmNlT2JqTGlzdFtpbmRleF1cblxuICAgICAgICAgIGxldCBzcmNDb3B5U2l6ZSA9IHJlc0l0ZW1TdGF0LnNpemVcbiAgICAgICAgICAvLyBDaGVjayBpZiBhIHNlZ21lbnQgaXMgc3BlY2lmaWVkLCBhbmQgaWYgc28sIGlzIHRoZVxuICAgICAgICAgIC8vIHNlZ21lbnQgd2l0aGluIG9iamVjdCBib3VuZHM/XG4gICAgICAgICAgaWYgKHNyY0NvbmZpZy5NYXRjaFJhbmdlKSB7XG4gICAgICAgICAgICAvLyBTaW5jZSByYW5nZSBpcyBzcGVjaWZpZWQsXG4gICAgICAgICAgICAvLyAgICAwIDw9IHNyYy5zcmNTdGFydCA8PSBzcmMuc3JjRW5kXG4gICAgICAgICAgICAvLyBzbyBvbmx5IGludmFsaWQgY2FzZSB0byBjaGVjayBpczpcbiAgICAgICAgICAgIGNvbnN0IHNyY1N0YXJ0ID0gc3JjQ29uZmlnLlN0YXJ0XG4gICAgICAgICAgICBjb25zdCBzcmNFbmQgPSBzcmNDb25maWcuRW5kXG4gICAgICAgICAgICBpZiAoc3JjRW5kID49IHNyY0NvcHlTaXplIHx8IHNyY1N0YXJ0IDwgMCkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgICAgICAgIGBDb3B5U3JjT3B0aW9ucyAke2luZGV4fSBoYXMgaW52YWxpZCBzZWdtZW50LXRvLWNvcHkgWyR7c3JjU3RhcnR9LCAke3NyY0VuZH1dIChzaXplIGlzICR7c3JjQ29weVNpemV9KWAsXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNyY0NvcHlTaXplID0gc3JjRW5kIC0gc3JjU3RhcnQgKyAxXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gT25seSB0aGUgbGFzdCBzb3VyY2UgbWF5IGJlIGxlc3MgdGhhbiBgYWJzTWluUGFydFNpemVgXG4gICAgICAgICAgaWYgKHNyY0NvcHlTaXplIDwgUEFSVF9DT05TVFJBSU5UUy5BQlNfTUlOX1BBUlRfU0laRSAmJiBpbmRleCA8IHNvdXJjZUZpbGVzTGVuZ3RoIC0gMSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgICAgICAgYENvcHlTcmNPcHRpb25zICR7aW5kZXh9IGlzIHRvbyBzbWFsbCAoJHtzcmNDb3B5U2l6ZX0pIGFuZCBpdCBpcyBub3QgdGhlIGxhc3QgcGFydC5gLFxuICAgICAgICAgICAgKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIElzIGRhdGEgdG8gY29weSB0b28gbGFyZ2U/XG4gICAgICAgICAgdG90YWxTaXplICs9IHNyY0NvcHlTaXplXG4gICAgICAgICAgaWYgKHRvdGFsU2l6ZSA+IFBBUlRfQ09OU1RSQUlOVFMuTUFYX01VTFRJUEFSVF9QVVRfT0JKRUNUX1NJWkUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYENhbm5vdCBjb21wb3NlIGFuIG9iamVjdCBvZiBzaXplICR7dG90YWxTaXplfSAoPiA1VGlCKWApXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gcmVjb3JkIHNvdXJjZSBzaXplXG4gICAgICAgICAgc3JjT2JqZWN0U2l6ZXNbaW5kZXhdID0gc3JjQ29weVNpemVcblxuICAgICAgICAgIC8vIGNhbGN1bGF0ZSBwYXJ0cyBuZWVkZWQgZm9yIGN1cnJlbnQgc291cmNlXG4gICAgICAgICAgdG90YWxQYXJ0cyArPSBwYXJ0c1JlcXVpcmVkKHNyY0NvcHlTaXplKVxuICAgICAgICAgIC8vIERvIHdlIG5lZWQgbW9yZSBwYXJ0cyB0aGFuIHdlIGFyZSBhbGxvd2VkP1xuICAgICAgICAgIGlmICh0b3RhbFBhcnRzID4gUEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVFNfQ09VTlQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgICAgIGBZb3VyIHByb3Bvc2VkIGNvbXBvc2Ugb2JqZWN0IHJlcXVpcmVzIG1vcmUgdGhhbiAke1BBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UfSBwYXJ0c2AsXG4gICAgICAgICAgICApXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIHJlc0l0ZW1TdGF0XG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKCh0b3RhbFBhcnRzID09PSAxICYmIHRvdGFsU2l6ZSA8PSBQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUX1NJWkUpIHx8IHRvdGFsU2l6ZSA9PT0gMCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLmNvcHlPYmplY3Qoc291cmNlT2JqTGlzdFswXSwgZGVzdE9iakNvbmZpZywgY2IpIC8vIHVzZSBjb3B5T2JqZWN0VjJcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHByZXNlcnZlIGV0YWcgdG8gYXZvaWQgbW9kaWZpY2F0aW9uIG9mIG9iamVjdCB3aGlsZSBjb3B5aW5nLlxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNvdXJjZUZpbGVzTGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICBzb3VyY2VPYmpMaXN0W2ldLk1hdGNoRVRhZyA9IHZhbGlkYXRlZFN0YXRzW2ldLmV0YWdcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNwbGl0UGFydFNpemVMaXN0ID0gdmFsaWRhdGVkU3RhdHMubWFwKChyZXNJdGVtU3RhdCwgaWR4KSA9PiB7XG4gICAgICAgICAgY29uc3QgY2FsU2l6ZSA9IGNhbGN1bGF0ZUV2ZW5TcGxpdHMoc3JjT2JqZWN0U2l6ZXNbaWR4XSwgc291cmNlT2JqTGlzdFtpZHhdKVxuICAgICAgICAgIHJldHVybiBjYWxTaXplXG4gICAgICAgIH0pXG5cbiAgICAgICAgZnVuY3Rpb24gZ2V0VXBsb2FkUGFydENvbmZpZ0xpc3QodXBsb2FkSWQpIHtcbiAgICAgICAgICBjb25zdCB1cGxvYWRQYXJ0Q29uZmlnTGlzdCA9IFtdXG5cbiAgICAgICAgICBzcGxpdFBhcnRTaXplTGlzdC5mb3JFYWNoKChzcGxpdFNpemUsIHNwbGl0SW5kZXgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgc3RhcnRJbmRleDogc3RhcnRJZHgsIGVuZEluZGV4OiBlbmRJZHgsIG9iakluZm86IG9iakNvbmZpZyB9ID0gc3BsaXRTaXplXG5cbiAgICAgICAgICAgIGxldCBwYXJ0SW5kZXggPSBzcGxpdEluZGV4ICsgMSAvLyBwYXJ0IGluZGV4IHN0YXJ0cyBmcm9tIDEuXG4gICAgICAgICAgICBjb25zdCB0b3RhbFVwbG9hZHMgPSBBcnJheS5mcm9tKHN0YXJ0SWR4KVxuXG4gICAgICAgICAgICBjb25zdCBoZWFkZXJzID0gc291cmNlT2JqTGlzdFtzcGxpdEluZGV4XS5nZXRIZWFkZXJzKClcblxuICAgICAgICAgICAgdG90YWxVcGxvYWRzLmZvckVhY2goKHNwbGl0U3RhcnQsIHVwbGRDdHJJZHgpID0+IHtcbiAgICAgICAgICAgICAgbGV0IHNwbGl0RW5kID0gZW5kSWR4W3VwbGRDdHJJZHhdXG5cbiAgICAgICAgICAgICAgY29uc3Qgc291cmNlT2JqID0gYCR7b2JqQ29uZmlnLkJ1Y2tldH0vJHtvYmpDb25maWcuT2JqZWN0fWBcbiAgICAgICAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UnXSA9IGAke3NvdXJjZU9ian1gXG4gICAgICAgICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLXJhbmdlJ10gPSBgYnl0ZXM9JHtzcGxpdFN0YXJ0fS0ke3NwbGl0RW5kfWBcblxuICAgICAgICAgICAgICBjb25zdCB1cGxvYWRQYXJ0Q29uZmlnID0ge1xuICAgICAgICAgICAgICAgIGJ1Y2tldE5hbWU6IGRlc3RPYmpDb25maWcuQnVja2V0LFxuICAgICAgICAgICAgICAgIG9iamVjdE5hbWU6IGRlc3RPYmpDb25maWcuT2JqZWN0LFxuICAgICAgICAgICAgICAgIHVwbG9hZElEOiB1cGxvYWRJZCxcbiAgICAgICAgICAgICAgICBwYXJ0TnVtYmVyOiBwYXJ0SW5kZXgsXG4gICAgICAgICAgICAgICAgaGVhZGVyczogaGVhZGVycyxcbiAgICAgICAgICAgICAgICBzb3VyY2VPYmo6IHNvdXJjZU9iaixcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIHVwbG9hZFBhcnRDb25maWdMaXN0LnB1c2godXBsb2FkUGFydENvbmZpZylcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgfSlcblxuICAgICAgICAgIHJldHVybiB1cGxvYWRQYXJ0Q29uZmlnTGlzdFxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcGVyZm9ybVVwbG9hZFBhcnRzID0gKHVwbG9hZElkKSA9PiB7XG4gICAgICAgICAgY29uc3QgdXBsb2FkTGlzdCA9IGdldFVwbG9hZFBhcnRDb25maWdMaXN0KHVwbG9hZElkKVxuXG4gICAgICAgICAgYXN5bmMubWFwKHVwbG9hZExpc3QsIG1lLnVwbG9hZFBhcnRDb3B5LmJpbmQobWUpLCAoZXJyLCByZXMpID0+IHtcbiAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgdGhpcy5hYm9ydE11bHRpcGFydFVwbG9hZChkZXN0T2JqQ29uZmlnLkJ1Y2tldCwgZGVzdE9iakNvbmZpZy5PYmplY3QsIHVwbG9hZElkKS50aGVuKFxuICAgICAgICAgICAgICAgICgpID0+IGNiKCksXG4gICAgICAgICAgICAgICAgKGVycikgPT4gY2IoZXJyKSxcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IHBhcnRzRG9uZSA9IHJlcy5tYXAoKHBhcnRDb3B5KSA9PiAoeyBldGFnOiBwYXJ0Q29weS5ldGFnLCBwYXJ0OiBwYXJ0Q29weS5wYXJ0IH0pKVxuICAgICAgICAgICAgcmV0dXJuIG1lLmNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkKGRlc3RPYmpDb25maWcuQnVja2V0LCBkZXN0T2JqQ29uZmlnLk9iamVjdCwgdXBsb2FkSWQsIHBhcnRzRG9uZSwgY2IpXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG5ld1VwbG9hZEhlYWRlcnMgPSBkZXN0T2JqQ29uZmlnLmdldEhlYWRlcnMoKVxuXG4gICAgICAgIG1lLmluaXRpYXRlTmV3TXVsdGlwYXJ0VXBsb2FkKGRlc3RPYmpDb25maWcuQnVja2V0LCBkZXN0T2JqQ29uZmlnLk9iamVjdCwgbmV3VXBsb2FkSGVhZGVycykudGhlbihcbiAgICAgICAgICAodXBsb2FkSWQpID0+IHtcbiAgICAgICAgICAgIHBlcmZvcm1VcGxvYWRQYXJ0cyh1cGxvYWRJZClcbiAgICAgICAgICB9LFxuICAgICAgICAgIChlcnIpID0+IHtcbiAgICAgICAgICAgIGNiKGVyciwgbnVsbClcbiAgICAgICAgICB9LFxuICAgICAgICApXG4gICAgICB9KVxuICAgICAgLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICBjYihlcnJvciwgbnVsbClcbiAgICAgIH0pXG4gIH1cbiAgc2VsZWN0T2JqZWN0Q29udGVudChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBzZWxlY3RPcHRzID0ge30sIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cykpIHtcbiAgICAgIGlmICghaXNTdHJpbmcoc2VsZWN0T3B0cy5leHByZXNzaW9uKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzcWxFeHByZXNzaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgICAgfVxuICAgICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb24pKSB7XG4gICAgICAgIGlmICghaXNPYmplY3Qoc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb24pKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignaW5wdXRTZXJpYWxpemF0aW9uIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdpbnB1dFNlcmlhbGl6YXRpb24gaXMgcmVxdWlyZWQnKVxuICAgICAgfVxuICAgICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cy5vdXRwdXRTZXJpYWxpemF0aW9uKSkge1xuICAgICAgICBpZiAoIWlzT2JqZWN0KHNlbGVjdE9wdHMub3V0cHV0U2VyaWFsaXphdGlvbikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvdXRwdXRTZXJpYWxpemF0aW9uIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvdXRwdXRTZXJpYWxpemF0aW9uIGlzIHJlcXVpcmVkJylcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsaWQgc2VsZWN0IGNvbmZpZ3VyYXRpb24gaXMgcmVxdWlyZWQnKVxuICAgIH1cblxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BPU1QnXG4gICAgbGV0IHF1ZXJ5ID0gYHNlbGVjdGBcbiAgICBxdWVyeSArPSAnJnNlbGVjdC10eXBlPTInXG5cbiAgICBjb25zdCBjb25maWcgPSBbXG4gICAgICB7XG4gICAgICAgIEV4cHJlc3Npb246IHNlbGVjdE9wdHMuZXhwcmVzc2lvbixcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIEV4cHJlc3Npb25UeXBlOiBzZWxlY3RPcHRzLmV4cHJlc3Npb25UeXBlIHx8ICdTUUwnLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgSW5wdXRTZXJpYWxpemF0aW9uOiBbc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb25dLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgT3V0cHV0U2VyaWFsaXphdGlvbjogW3NlbGVjdE9wdHMub3V0cHV0U2VyaWFsaXphdGlvbl0sXG4gICAgICB9LFxuICAgIF1cblxuICAgIC8vIE9wdGlvbmFsXG4gICAgaWYgKHNlbGVjdE9wdHMucmVxdWVzdFByb2dyZXNzKSB7XG4gICAgICBjb25maWcucHVzaCh7IFJlcXVlc3RQcm9ncmVzczogc2VsZWN0T3B0cy5yZXF1ZXN0UHJvZ3Jlc3MgfSlcbiAgICB9XG4gICAgLy8gT3B0aW9uYWxcbiAgICBpZiAoc2VsZWN0T3B0cy5zY2FuUmFuZ2UpIHtcbiAgICAgIGNvbmZpZy5wdXNoKHsgU2NhblJhbmdlOiBzZWxlY3RPcHRzLnNjYW5SYW5nZSB9KVxuICAgIH1cblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdTZWxlY3RPYmplY3RDb250ZW50UmVxdWVzdCcsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoY29uZmlnKVxuXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgcGF5bG9hZCwgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuXG4gICAgICBsZXQgc2VsZWN0UmVzdWx0XG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVycy5zZWxlY3RPYmplY3RDb250ZW50VHJhbnNmb3JtZXIoKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICAgICAgICBzZWxlY3RSZXN1bHQgPSBwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZShkYXRhKVxuICAgICAgICB9KVxuICAgICAgICAub24oJ2Vycm9yJywgY2IpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4ge1xuICAgICAgICAgIGNiKG51bGwsIHNlbGVjdFJlc3VsdClcbiAgICAgICAgfSlcbiAgICB9KVxuICB9XG59XG5cbi8vIFByb21pc2lmeSB2YXJpb3VzIHB1YmxpYy1mYWNpbmcgQVBJcyBvbiB0aGUgQ2xpZW50IG1vZHVsZS5cbkNsaWVudC5wcm90b3R5cGUubWFrZUJ1Y2tldCA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLm1ha2VCdWNrZXQpXG5DbGllbnQucHJvdG90eXBlLmJ1Y2tldEV4aXN0cyA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmJ1Y2tldEV4aXN0cylcblxuQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3QgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLmdldFBhcnRpYWxPYmplY3QgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRQYXJ0aWFsT2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5mR2V0T2JqZWN0ID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuZkdldE9iamVjdClcbkNsaWVudC5wcm90b3R5cGUucHV0T2JqZWN0ID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUucHV0T2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5mUHV0T2JqZWN0ID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuZlB1dE9iamVjdClcbkNsaWVudC5wcm90b3R5cGUuY29weU9iamVjdCA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmNvcHlPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZU9iamVjdHMgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVPYmplY3RzKVxuXG5DbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFVybCA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFVybClcbkNsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkR2V0T2JqZWN0ID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkR2V0T2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5wcmVzaWduZWRQdXRPYmplY3QgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5wcmVzaWduZWRQdXRPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFBvc3RQb2xpY3kgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5wcmVzaWduZWRQb3N0UG9saWN5KVxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXROb3RpZmljYXRpb24gPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXROb3RpZmljYXRpb24pXG5DbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldE5vdGlmaWNhdGlvbiA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldE5vdGlmaWNhdGlvbilcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlQWxsQnVja2V0Tm90aWZpY2F0aW9uID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlQWxsQnVja2V0Tm90aWZpY2F0aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRQb2xpY3kgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRQb2xpY3kpXG5DbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldFBvbGljeSA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldFBvbGljeSlcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlSW5jb21wbGV0ZVVwbG9hZCA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZUluY29tcGxldGVVcGxvYWQpXG5DbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldFZlcnNpb25pbmcgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRWZXJzaW9uaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRWZXJzaW9uaW5nID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0VmVyc2lvbmluZylcbkNsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0VGFnZ2luZyA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldFRhZ2dpbmcpXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldFRhZ2dpbmcgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRUYWdnaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRUYWdnaW5nID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0VGFnZ2luZylcbkNsaWVudC5wcm90b3R5cGUuc2V0T2JqZWN0VGFnZ2luZyA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnNldE9iamVjdFRhZ2dpbmcpXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZU9iamVjdFRhZ2dpbmcgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVPYmplY3RUYWdnaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3RUYWdnaW5nID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0VGFnZ2luZylcbkNsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0TGlmZWN5Y2xlID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0TGlmZWN5Y2xlKVxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRMaWZlY3ljbGUgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRMaWZlY3ljbGUpXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldExpZmVjeWNsZSA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldExpZmVjeWNsZSlcbkNsaWVudC5wcm90b3R5cGUuc2V0T2JqZWN0TG9ja0NvbmZpZyA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnNldE9iamVjdExvY2tDb25maWcpXG5DbGllbnQucHJvdG90eXBlLmdldE9iamVjdExvY2tDb25maWcgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3RMb2NrQ29uZmlnKVxuQ2xpZW50LnByb3RvdHlwZS5wdXRPYmplY3RSZXRlbnRpb24gPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5wdXRPYmplY3RSZXRlbnRpb24pXG5DbGllbnQucHJvdG90eXBlLmdldE9iamVjdFJldGVudGlvbiA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmdldE9iamVjdFJldGVudGlvbilcbkNsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0RW5jcnlwdGlvbiA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldEVuY3J5cHRpb24pXG5DbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldEVuY3J5cHRpb24gPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRFbmNyeXB0aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRFbmNyeXB0aW9uID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlQnVja2V0RW5jcnlwdGlvbilcbkNsaWVudC5wcm90b3R5cGUuc2V0T2JqZWN0TGVnYWxIb2xkID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuc2V0T2JqZWN0TGVnYWxIb2xkKVxuQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3RMZWdhbEhvbGQgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3RMZWdhbEhvbGQpXG5DbGllbnQucHJvdG90eXBlLmNvbXBvc2VPYmplY3QgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5jb21wb3NlT2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5zZWxlY3RPYmplY3RDb250ZW50ID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuc2VsZWN0T2JqZWN0Q29udGVudClcblxuLy8gcmVmYWN0b3JlZCBBUEkgdXNlIHByb21pc2UgaW50ZXJuYWxseVxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVPYmplY3QgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZU9iamVjdClcbkNsaWVudC5wcm90b3R5cGUuc3RhdE9iamVjdCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuc3RhdE9iamVjdClcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlQnVja2V0ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXQpXG5DbGllbnQucHJvdG90eXBlLmxpc3RCdWNrZXRzID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5saXN0QnVja2V0cylcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlQnVja2V0UmVwbGljYXRpb24gPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRSZXBsaWNhdGlvbiA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0UmVwbGljYXRpb24pXG5DbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldFJlcGxpY2F0aW9uID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRSZXBsaWNhdGlvbilcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7OztBQWdCQSxJQUFBQSxFQUFBLEdBQUFDLHVCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBQyxJQUFBLEdBQUFGLHVCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBRSxNQUFBLEdBQUFILHVCQUFBLENBQUFDLE9BQUE7QUFFQSxJQUFBRyxNQUFBLEdBQUFILE9BQUE7QUFDQSxJQUFBSSxZQUFBLEdBQUFKLE9BQUE7QUFDQSxJQUFBSyxPQUFBLEdBQUFMLE9BQUE7QUFDQSxJQUFBTSxXQUFBLEdBQUFQLHVCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBTyxZQUFBLEdBQUFQLE9BQUE7QUFDQSxJQUFBUSxJQUFBLEdBQUFSLE9BQUE7QUFDQSxJQUFBUyxPQUFBLEdBQUFULE9BQUE7QUFFQSxJQUFBVSxNQUFBLEdBQUFYLHVCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBVyxRQUFBLEdBQUFYLE9BQUE7QUF5Q0FZLE1BQUEsQ0FBQUMsSUFBQSxDQUFBRixRQUFBLEVBQUFHLE9BQUEsV0FBQUMsR0FBQTtFQUFBLElBQUFBLEdBQUEsa0JBQUFBLEdBQUE7RUFBQSxJQUFBSCxNQUFBLENBQUFJLFNBQUEsQ0FBQUMsY0FBQSxDQUFBQyxJQUFBLENBQUFDLFlBQUEsRUFBQUosR0FBQTtFQUFBLElBQUFBLEdBQUEsSUFBQUssT0FBQSxJQUFBQSxPQUFBLENBQUFMLEdBQUEsTUFBQUosUUFBQSxDQUFBSSxHQUFBO0VBQUFLLE9BQUEsQ0FBQUwsR0FBQSxJQUFBSixRQUFBLENBQUFJLEdBQUE7QUFBQTtBQXhDQSxJQUFBTSxZQUFBLEdBQUFyQixPQUFBO0FBQ0EsSUFBQXNCLE9BQUEsR0FBQXRCLE9B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