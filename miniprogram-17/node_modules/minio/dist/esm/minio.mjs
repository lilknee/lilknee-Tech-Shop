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

import * as fs from "fs";
import * as path from "path";
import * as Stream from "stream";
import async from 'async';
import BlockStream2 from 'block-stream2';
import _ from 'lodash';
import * as querystring from 'query-string';
import { TextEncoder } from 'web-encoding';
import Xml from 'xml';
import xml2js from 'xml2js';
import * as errors from "./errors.mjs";
import { CopyDestinationOptions, CopySourceOptions, DEFAULT_REGION } from "./helpers.mjs";
import { callbackify } from "./internal/callbackify.mjs";
import { TypedClient } from "./internal/client.mjs";
import { CopyConditions } from "./internal/copy-conditions.mjs";
import { calculateEvenSplits, extractMetadata, getScope, getSourceVersionId, getVersionId, insertContentType, isBoolean, isFunction, isNumber, isObject, isReadableStream, isString, isValidBucketName, isValidDate, isValidObjectName, isValidPrefix, makeDateLong, PART_CONSTRAINTS, partsRequired, pipesetup, prependXAMZMeta, readableStream, sanitizeETag, toMd5, uriEscape, uriResourceEscape } from "./internal/helper.mjs";
import { PostPolicy } from "./internal/post-policy.mjs";
import { LEGAL_HOLD_STATUS, RETENTION_MODES, RETENTION_VALIDITY_UNITS } from "./internal/type.mjs";
import { NotificationConfig, NotificationPoller } from "./notification.mjs";
import { ObjectUploader } from "./object-uploader.mjs";
import { promisify } from "./promisify.mjs";
import { postPresignSignatureV4, presignSignatureV4 } from "./signing.mjs";
import * as transformers from "./transformers.mjs";
import { parseSelectObjectContentResponse } from "./xml-parsers.mjs";
export * from "./helpers.mjs";
export * from "./notification.mjs";
export { CopyConditions, PostPolicy };
export class Client extends TypedClient {
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
    if (!isString(appName)) {
      throw new TypeError(`Invalid appName: ${appName}`);
    }
    if (appName.trim() === '') {
      throw new errors.InvalidArgumentError('Input appName cannot be empty.');
    }
    if (!isString(appVersion)) {
      throw new TypeError(`Invalid appVersion: ${appVersion}`);
    }
    if (appVersion.trim() === '') {
      throw new errors.InvalidArgumentError('Input appVersion cannot be empty.');
    }
    this.userAgent = `${this.userAgent} ${appName}/${appVersion}`;
  }

  // Calculate part size given the object size. Part size will be atleast this.partSize
  calculatePartSize(size) {
    if (!isNumber(size)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    // Backward Compatibility
    if (isObject(region)) {
      cb = makeOpts;
      makeOpts = region;
      region = '';
    }
    if (isFunction(region)) {
      cb = region;
      region = '';
      makeOpts = {};
    }
    if (isFunction(makeOpts)) {
      cb = makeOpts;
      makeOpts = {};
    }
    if (!isString(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (!isObject(makeOpts)) {
      throw new TypeError('makeOpts should be of type "object"');
    }
    if (!isFunction(cb)) {
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
    if (region && region !== DEFAULT_REGION) {
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
      payload = Xml(payloadObject);
    }
    var method = 'PUT';
    var headers = {};
    if (makeOpts.ObjectLocking) {
      headers['x-amz-bucket-object-lock-enabled'] = true;
    }
    if (!region) {
      region = DEFAULT_REGION;
    }
    const processWithRetry = err => {
      if (err && (region === '' || region === DEFAULT_REGION)) {
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
    if (!isValidBucketName(bucket)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucket);
    }
    if (!isValidPrefix(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!isBoolean(recursive)) {
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
        async.eachSeries(result.uploads, (upload, cb) => {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isFunction(cb)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.IsValidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var removeUploadId;
    async.during(cb => {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    // Backward Compatibility
    if (isFunction(getOpts)) {
      cb = getOpts;
      getOpts = {};
    }
    if (!isFunction(cb)) {
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
    async.waterfall([cb => this.statObject(bucketName, objectName, getOpts, cb), (result, cb) => {
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
      pipesetup(downloadStream, partFileStream).on('error', e => cb(e)).on('finish', cb);
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    // Backward Compatibility
    if (isFunction(getOpts)) {
      cb = getOpts;
      getOpts = {};
    }
    if (!isFunction(cb)) {
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
    if (isFunction(length)) {
      cb = length;
      length = 0;
    }
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isNumber(offset)) {
      throw new TypeError('offset should be of type "number"');
    }
    if (!isNumber(length)) {
      throw new TypeError('length should be of type "number"');
    }
    // Backward Compatibility
    if (isFunction(getOpts)) {
      cb = getOpts;
      getOpts = {};
    }
    if (!isFunction(cb)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    if (isFunction(metaData)) {
      callback = metaData;
      metaData = {}; // Set metaData empty if no metaData provided.
    }

    if (!isObject(metaData)) {
      throw new TypeError('metaData should be of type "object"');
    }

    // Inserts correct `content-type` attribute based on metaData and filePath
    metaData = insertContentType(metaData, filePath);
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }

    // We'll need to shift arguments to the left because of size and metaData.
    if (isFunction(size)) {
      callback = size;
      metaData = {};
    } else if (isFunction(metaData)) {
      callback = metaData;
      metaData = {};
    }

    // We'll need to shift arguments to the left because of metaData
    // and size being optional.
    if (isObject(size)) {
      metaData = size;
    }

    // Ensures Metadata has appropriate prefix for A3 API
    metaData = prependXAMZMeta(metaData);
    if (typeof stream === 'string' || stream instanceof Buffer) {
      // Adapts the non-stream interface into a stream.
      size = stream.length;
      stream = readableStream(stream);
    } else if (!isReadableStream(stream)) {
      throw new TypeError('third argument should be of type "stream.Readable" or "Buffer" or "string"');
    }
    if (!isFunction(callback)) {
      throw new TypeError('callback should be of type "function"');
    }
    if (isNumber(size) && size < 0) {
      throw new errors.InvalidArgumentError(`size cannot be negative, given size: ${size}`);
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (!isNumber(size)) {
      size = this.maxObjectSize;
    }
    size = this.calculatePartSize(size);

    // s3 requires that all non-end chunks be at least `this.partSize`,
    // so we chunk the stream until we hit either that size or the end before
    // we flush it to s3.
    let chunker = new BlockStream2({
      size,
      zeroPadding: false
    });

    // This is a Writable stream that can be written to in order to upload
    // to the specified bucket and object automatically.
    let uploader = new ObjectUploader(this, bucketName, objectName, size, metaData, callback);
    // stream => chunker => uploader
    pipesetup(stream, chunker, uploader);
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(srcObject)) {
      throw new TypeError('srcObject should be of type "string"');
    }
    if (srcObject === '') {
      throw new errors.InvalidPrefixError(`Empty source prefix`);
    }
    if (conditions !== null && !(conditions instanceof CopyConditions)) {
      throw new TypeError('conditions should be of type "CopyConditions"');
    }
    var headers = {};
    headers['x-amz-copy-source'] = uriResourceEscape(srcObject);
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
      pipesetup(response, transformer).on('error', e => cb(e)).on('data', data => cb(null, data));
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
    if (!(sourceConfig instanceof CopySourceOptions)) {
      throw new errors.InvalidArgumentError('sourceConfig should of type CopySourceOptions ');
    }
    if (!(destConfig instanceof CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (!destConfig.validate()) {
      return false;
    }
    if (!destConfig.validate()) {
      return false;
    }
    if (!isFunction(cb)) {
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
      pipesetup(response, transformer).on('error', e => cb(e)).on('data', data => {
        const resHeaders = response.headers;
        const copyObjResponse = {
          Bucket: destConfig.Bucket,
          Key: destConfig.Object,
          LastModified: data.LastModified,
          MetaData: extractMetadata(resHeaders),
          VersionId: getVersionId(resHeaders),
          SourceVersionId: getSourceVersionId(resHeaders),
          Etag: sanitizeETag(resHeaders.etag),
          Size: +resHeaders['content-length']
        };
        return cb(null, copyObjResponse);
      });
    });
  }

  // Backward compatibility for Copy Object API.
  copyObject(...allArgs) {
    if (allArgs[0] instanceof CopySourceOptions && allArgs[1] instanceof CopyDestinationOptions) {
      return this.copyObjectV2(...arguments);
    }
    return this.copyObjectV1(...arguments);
  }

  // list a batch of objects
  listObjectsQuery(bucketName, prefix, marker, listQueryOpts = {}) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isString(marker)) {
      throw new TypeError('marker should be of type "string"');
    }
    let {
      Delimiter,
      MaxKeys,
      IncludeVersion
    } = listQueryOpts;
    if (!isObject(listQueryOpts)) {
      throw new TypeError('listQueryOpts should be of type "object"');
    }
    if (!isString(Delimiter)) {
      throw new TypeError('Delimiter should be of type "string"');
    }
    if (!isNumber(MaxKeys)) {
      throw new TypeError('MaxKeys should be of type "number"');
    }
    const queries = [];
    // escape every value in query string, except maxKeys
    queries.push(`prefix=${uriEscape(prefix)}`);
    queries.push(`delimiter=${uriEscape(Delimiter)}`);
    queries.push(`encoding-type=url`);
    if (IncludeVersion) {
      queries.push(`versions`);
    }
    if (marker) {
      marker = uriEscape(marker);
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
      pipesetup(response, transformer);
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidPrefix(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isBoolean(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    if (!isObject(listOpts)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isString(continuationToken)) {
      throw new TypeError('continuationToken should be of type "string"');
    }
    if (!isString(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    if (!isNumber(maxKeys)) {
      throw new TypeError('maxKeys should be of type "number"');
    }
    if (!isString(startAfter)) {
      throw new TypeError('startAfter should be of type "string"');
    }
    var queries = [];

    // Call for listing objects v2 API
    queries.push(`list-type=2`);
    queries.push(`encoding-type=url`);

    // escape every value in query string, except maxKeys
    queries.push(`prefix=${uriEscape(prefix)}`);
    queries.push(`delimiter=${uriEscape(delimiter)}`);
    if (continuationToken) {
      continuationToken = uriEscape(continuationToken);
      queries.push(`continuation-token=${continuationToken}`);
    }
    // Set start-after
    if (startAfter) {
      startAfter = uriEscape(startAfter);
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
      pipesetup(response, transformer);
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidPrefix(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isBoolean(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    if (!isString(startAfter)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Array.isArray(objectsList)) {
      throw new errors.InvalidArgumentError('objectsList should be a list');
    }
    if (!isFunction(cb)) {
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
    const encoder = new TextEncoder();
    const batchResults = [];
    async.eachSeries(result.listOfList, (list, batchCb) => {
      var objects = [];
      list.forEach(function (value) {
        if (isObject(value)) {
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
      const builder = new xml2js.Builder({
        headless: true
      });
      let payload = builder.buildObject(deleteObjects);
      payload = Buffer.from(encoder.encode(payload));
      const headers = {};
      headers['Content-MD5'] = toMd5(payload);
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
        pipesetup(response, transformers.removeObjectsTransformer()).on('data', data => {
          removeObjectsResult = data;
        }).on('error', e => {
          return batchCb(e, null);
        }).on('end', () => {
          batchResults.push(removeObjectsResult);
          return batchCb(null, removeObjectsResult);
        });
      });
    }, () => {
      cb(null, _.flatten(batchResults));
    });
  }

  // Get the policy on a bucket or an object prefix.
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `callback(err, policy)` _function_: callback function
  getBucketPolicy(bucketName, cb) {
    // Validate arguments.
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isFunction(cb)) {
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
      pipesetup(response, transformers.getConcater()).on('data', data => policy = data).on('error', cb).on('end', () => {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isString(policy)) {
      throw new errors.InvalidBucketPolicyError(`Invalid bucket policy: ${policy} - must be "string"`);
    }
    if (!isFunction(cb)) {
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
    if (isFunction(requestDate)) {
      cb = requestDate;
      requestDate = new Date();
    }
    if (isFunction(reqParams)) {
      cb = reqParams;
      reqParams = {};
      requestDate = new Date();
    }
    if (isFunction(expires)) {
      cb = expires;
      reqParams = {};
      expires = 24 * 60 * 60 * 7; // 7 days in seconds
      requestDate = new Date();
    }
    if (!isNumber(expires)) {
      throw new TypeError('expires should be of type "number"');
    }
    if (!isObject(reqParams)) {
      throw new TypeError('reqParams should be of type "object"');
    }
    if (!isValidDate(requestDate)) {
      throw new TypeError('requestDate should be of type "Date" and valid');
    }
    if (!isFunction(cb)) {
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
        url = presignSignatureV4(reqOptions, this.accessKey, this.secretKey, this.sessionToken, region, requestDate, expires);
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (isFunction(respHeaders)) {
      cb = respHeaders;
      respHeaders = {};
      requestDate = new Date();
    }
    var validRespHeaders = ['response-content-type', 'response-content-language', 'response-expires', 'response-cache-control', 'response-content-disposition', 'response-content-encoding'];
    validRespHeaders.forEach(header => {
      if (respHeaders !== undefined && respHeaders[header] !== undefined && !isString(respHeaders[header])) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.presignedUrl('PUT', bucketName, objectName, expires, cb);
  }

  // return PostPolicy object
  newPostPolicy() {
    return new PostPolicy();
  }

  // presignedPostPolicy can be used in situations where we want more control on the upload than what
  // presignedPutObject() provides. i.e Using presignedPostPolicy we will be able to put policy restrictions
  // on the object's `name` `bucket` `expiry` `Content-Type` `Content-Disposition` `metaData`
  presignedPostPolicy(postPolicy, cb) {
    if (this.anonymous) {
      throw new errors.AnonymousRequestError('Presigned POST policy cannot be generated for anonymous requests');
    }
    if (!isObject(postPolicy)) {
      throw new TypeError('postPolicy should be of type "object"');
    }
    if (!isFunction(cb)) {
      throw new TypeError('cb should be of type "function"');
    }
    this.getBucketRegion(postPolicy.formData.bucket, (e, region) => {
      if (e) {
        return cb(e);
      }
      var date = new Date();
      var dateStr = makeDateLong(date);
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
      postPolicy.policy.conditions.push(['eq', '$x-amz-credential', this.accessKey + '/' + getScope(region, date)]);
      postPolicy.formData['x-amz-credential'] = this.accessKey + '/' + getScope(region, date);
      if (this.sessionToken) {
        postPolicy.policy.conditions.push(['eq', '$x-amz-security-token', this.sessionToken]);
        postPolicy.formData['x-amz-security-token'] = this.sessionToken;
      }
      var policyBase64 = Buffer.from(JSON.stringify(postPolicy.policy)).toString('base64');
      postPolicy.formData.policy = policyBase64;
      var signature = postPresignSignatureV4(region, date, this.secretKey, policyBase64);
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!isObject(etags)) {
      throw new TypeError('etags should be of type "Array"');
    }
    if (!isFunction(cb)) {
      throw new TypeError('cb should be of type "function"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    var method = 'POST';
    var query = `uploadId=${uriEscape(uploadId)}`;
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
    var payload = Xml(payloadObject);
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
      pipesetup(response, transformer).on('error', e => cb(e)).on('data', result => {
        if (result.errCode) {
          // Multipart Complete API returns an error XML after a 200 http status
          cb(new errors.S3Error(result.errMessage));
        } else {
          const completeMultipartResult = {
            etag: result.etag,
            versionId: getVersionId(response.headers)
          };
          cb(null, completeMultipartResult);
        }
      });
    });
  }

  // Called by listIncompleteUploads to fetch a batch of incomplete uploads.
  listIncompleteUploadsQuery(bucketName, prefix, keyMarker, uploadIdMarker, delimiter) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isString(keyMarker)) {
      throw new TypeError('keyMarker should be of type "string"');
    }
    if (!isString(uploadIdMarker)) {
      throw new TypeError('uploadIdMarker should be of type "string"');
    }
    if (!isString(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    var queries = [];
    queries.push(`prefix=${uriEscape(prefix)}`);
    queries.push(`delimiter=${uriEscape(delimiter)}`);
    if (keyMarker) {
      keyMarker = uriEscape(keyMarker);
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
      pipesetup(response, transformer);
    });
    return transformer;
  }

  // Find uploadId of an incomplete upload.
  findUploadId(bucketName, objectName, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isFunction(cb)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isObject(config)) {
      throw new TypeError('notification config should be of type "Object"');
    }
    if (!isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var method = 'PUT';
    var query = 'notification';
    var builder = new xml2js.Builder({
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
    this.setBucketNotification(bucketName, new NotificationConfig(), cb);
  }

  // Return the list of notification configurations stored
  // in the S3 provider
  getBucketNotification(bucketName, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isFunction(cb)) {
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
      pipesetup(response, transformer).on('data', result => bucketNotification = result).on('error', e => cb(e)).on('end', () => cb(null, bucketNotification));
    });
  }

  // Listens for bucket notifications. Returns an EventEmitter.
  listenBucketNotification(bucketName, prefix, suffix, events) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix must be of type string');
    }
    if (!isString(suffix)) {
      throw new TypeError('suffix must be of type string');
    }
    if (!Array.isArray(events)) {
      throw new TypeError('events must be of type Array');
    }
    let listener = new NotificationPoller(this, bucketName, prefix, suffix, events);
    listener.start();
    return listener;
  }
  getBucketVersioning(bucketName, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isFunction(cb)) {
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
      pipesetup(response, transformers.bucketVersioningTransformer()).on('data', data => {
        versionConfig = data;
      }).on('error', cb).on('end', () => {
        cb(null, versionConfig);
      });
    });
  }
  setBucketVersioning(bucketName, versionConfig, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Object.keys(versionConfig).length) {
      throw new errors.InvalidArgumentError('versionConfig should be of type "object"');
    }
    if (!isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var method = 'PUT';
    var query = 'versioning';
    var builder = new xml2js.Builder({
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
    const encoder = new TextEncoder();
    const headers = {};
    const builder = new xml2js.Builder({
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    let payload = builder.buildObject(taggingConfig);
    payload = Buffer.from(encoder.encode(payload));
    headers['Content-MD5'] = toMd5(payload);
    const requestOptions = {
      method,
      bucketName,
      query,
      headers
    };
    if (objectName) {
      requestOptions['objectName'] = objectName;
    }
    headers['Content-MD5'] = toMd5(payload);
    this.makeRequest(requestOptions, payload, [200], '', false, cb);
  }

  /** Set Tags on a Bucket
   * __Arguments__
   * bucketName _string_
   * tags _object_ of the form {'<tag-key-1>':'<tag-value-1>','<tag-key-2>':'<tag-value-2>'}
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  setBucketTagging(bucketName, tags, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isObject(tags)) {
      throw new errors.InvalidArgumentError('tags should be of type "object"');
    }
    if (Object.keys(tags).length > 10) {
      throw new errors.InvalidArgumentError('maximum tags allowed is 10"');
    }
    if (!isFunction(cb)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (isFunction(putOpts)) {
      cb = putOpts;
      putOpts = {};
    }
    if (!isObject(tags)) {
      throw new errors.InvalidArgumentError('tags should be of type "object"');
    }
    if (Object.keys(tags).length > 10) {
      throw new errors.InvalidArgumentError('Maximum tags allowed is 10"');
    }
    if (!isFunction(cb)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isFunction(cb)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (isFunction(removeOpts)) {
      cb = removeOpts;
      removeOpts = {};
    }
    if (removeOpts && Object.keys(removeOpts).length && !isObject(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    if (!isFunction(cb)) {
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
    if (!isValidBucketName(bucketName)) {
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
      pipesetup(response, transformer).on('data', result => tagsList = result).on('error', e => cb(e)).on('end', () => cb(null, tagsList));
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (isFunction(getOpts)) {
      cb = getOpts;
      getOpts = {};
    }
    if (!isObject(getOpts)) {
      throw new errors.InvalidArgumentError('getOpts should be of type "object"');
    }
    if (!isFunction(cb)) {
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
      pipesetup(response, transformer).on('data', result => tagsList = result).on('error', e => cb(e)).on('end', () => cb(null, tagsList));
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
    const encoder = new TextEncoder();
    const headers = {};
    const builder = new xml2js.Builder({
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
    headers['Content-MD5'] = toMd5(payload);
    this.makeRequest(requestOptions, payload, [200], '', false, cb);
  }

  /** Remove lifecycle configuration of a bucket.
   * bucketName _string_
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  removeBucketLifecycle(bucketName, cb) {
    if (!isValidBucketName(bucketName)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (_.isEmpty(lifeCycleConfig)) {
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
    if (!isValidBucketName(bucketName)) {
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
      pipesetup(response, transformer).on('data', result => lifecycleConfig = result).on('error', e => cb(e)).on('end', () => cb(null, lifecycleConfig));
    });
  }
  setObjectLockConfig(bucketName, lockConfigOpts = {}, cb) {
    const retentionModes = [RETENTION_MODES.COMPLIANCE, RETENTION_MODES.GOVERNANCE];
    const validUnits = [RETENTION_VALIDITY_UNITS.DAYS, RETENTION_VALIDITY_UNITS.YEARS];
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (lockConfigOpts.mode && !retentionModes.includes(lockConfigOpts.mode)) {
      throw new TypeError(`lockConfigOpts.mode should be one of ${retentionModes}`);
    }
    if (lockConfigOpts.unit && !validUnits.includes(lockConfigOpts.unit)) {
      throw new TypeError(`lockConfigOpts.unit should be one of ${validUnits}`);
    }
    if (lockConfigOpts.validity && !isNumber(lockConfigOpts.validity)) {
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
      if (_.difference(configKeys, ['unit', 'mode', 'validity']).length !== 0) {
        throw new TypeError(`lockConfigOpts.mode,lockConfigOpts.unit,lockConfigOpts.validity all the properties should be specified.`);
      } else {
        config.Rule = {
          DefaultRetention: {}
        };
        if (lockConfigOpts.mode) {
          config.Rule.DefaultRetention.Mode = lockConfigOpts.mode;
        }
        if (lockConfigOpts.unit === RETENTION_VALIDITY_UNITS.DAYS) {
          config.Rule.DefaultRetention.Days = lockConfigOpts.validity;
        } else if (lockConfigOpts.unit === RETENTION_VALIDITY_UNITS.YEARS) {
          config.Rule.DefaultRetention.Years = lockConfigOpts.validity;
        }
      }
    }
    const builder = new xml2js.Builder({
      rootName: 'ObjectLockConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
    this.makeRequest({
      method,
      bucketName,
      query,
      headers
    }, payload, [200], '', false, cb);
  }
  getObjectLockConfig(bucketName, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isFunction(cb)) {
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
      pipesetup(response, transformers.objectLockTransformer()).on('data', data => {
        objectLockConfig = data;
      }).on('error', cb).on('end', () => {
        cb(null, objectLockConfig);
      });
    });
  }
  putObjectRetention(bucketName, objectName, retentionOpts = {}, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(retentionOpts)) {
      throw new errors.InvalidArgumentError('retentionOpts should be of type "object"');
    } else {
      if (retentionOpts.governanceBypass && !isBoolean(retentionOpts.governanceBypass)) {
        throw new errors.InvalidArgumentError('Invalid value for governanceBypass', retentionOpts.governanceBypass);
      }
      if (retentionOpts.mode && ![RETENTION_MODES.COMPLIANCE, RETENTION_MODES.GOVERNANCE].includes(retentionOpts.mode)) {
        throw new errors.InvalidArgumentError('Invalid object retention mode ', retentionOpts.mode);
      }
      if (retentionOpts.retainUntilDate && !isString(retentionOpts.retainUntilDate)) {
        throw new errors.InvalidArgumentError('Invalid value for retainUntilDate', retentionOpts.retainUntilDate);
      }
      if (retentionOpts.versionId && !isString(retentionOpts.versionId)) {
        throw new errors.InvalidArgumentError('Invalid value for versionId', retentionOpts.versionId);
      }
    }
    if (!isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    const method = 'PUT';
    let query = 'retention';
    const headers = {};
    if (retentionOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    const builder = new xml2js.Builder({
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
    headers['Content-MD5'] = toMd5(payload);
    this.makeRequest({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload, [200, 204], '', false, cb);
  }
  getObjectRetention(bucketName, objectName, getOpts, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(getOpts)) {
      throw new errors.InvalidArgumentError('callback should be of type "object"');
    } else if (getOpts.versionId && !isString(getOpts.versionId)) {
      throw new errors.InvalidArgumentError('VersionID should be of type "string"');
    }
    if (cb && !isFunction(cb)) {
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
      pipesetup(response, transformers.objectRetentionTransformer()).on('data', data => {
        retentionConfig = data;
      }).on('error', cb).on('end', () => {
        cb(null, retentionConfig);
      });
    });
  }
  setBucketEncryption(bucketName, encryptionConfig, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (isFunction(encryptionConfig)) {
      cb = encryptionConfig;
      encryptionConfig = null;
    }
    if (!_.isEmpty(encryptionConfig) && encryptionConfig.Rule.length > 1) {
      throw new errors.InvalidArgumentError('Invalid Rule length. Only one rule is allowed.: ' + encryptionConfig.Rule);
    }
    if (cb && !isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    let encryptionObj = encryptionConfig;
    if (_.isEmpty(encryptionConfig)) {
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
    let builder = new xml2js.Builder({
      rootName: 'ServerSideEncryptionConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    let payload = builder.buildObject(encryptionObj);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
    this.makeRequest({
      method,
      bucketName,
      query,
      headers
    }, payload, [200], '', false, cb);
  }
  getBucketEncryption(bucketName, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isFunction(cb)) {
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
      pipesetup(response, transformers.bucketEncryptionTransformer()).on('data', data => {
        bucketEncConfig = data;
      }).on('error', cb).on('end', () => {
        cb(null, bucketEncConfig);
      });
    });
  }
  removeBucketEncryption(bucketName, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isFunction(cb)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (isFunction(getOpts)) {
      cb = getOpts;
      getOpts = {};
    }
    if (!isObject(getOpts)) {
      throw new TypeError('getOpts should be of type "Object"');
    } else if (Object.keys(getOpts).length > 0 && getOpts.versionId && !isString(getOpts.versionId)) {
      throw new TypeError('versionId should be of type string.:', getOpts.versionId);
    }
    if (!isFunction(cb)) {
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
      pipesetup(response, transformers.objectLegalHoldTransformer()).on('data', data => {
        legalHoldConfig = data;
      }).on('error', cb).on('end', () => {
        cb(null, legalHoldConfig);
      });
    });
  }
  setObjectLegalHold(bucketName, objectName, setOpts = {}, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    const defaultOpts = {
      status: LEGAL_HOLD_STATUS.ENABLED
    };
    if (isFunction(setOpts)) {
      cb = setOpts;
      setOpts = defaultOpts;
    }
    if (!isObject(setOpts)) {
      throw new TypeError('setOpts should be of type "Object"');
    } else {
      if (![LEGAL_HOLD_STATUS.ENABLED, LEGAL_HOLD_STATUS.DISABLED].includes(setOpts.status)) {
        throw new TypeError('Invalid status: ' + setOpts.status);
      }
      if (setOpts.versionId && !setOpts.versionId.length) {
        throw new TypeError('versionId should be of type string.:' + setOpts.versionId);
      }
    }
    if (!isFunction(cb)) {
      throw new errors.InvalidArgumentError('callback should be of type "function"');
    }
    if (_.isEmpty(setOpts)) {
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
    const builder = new xml2js.Builder({
      rootName: 'LegalHold',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
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
      pipesetup(response, transformers.uploadPartTransformer()).on('data', data => {
        partCopyResult = data;
      }).on('error', cb).on('end', () => {
        let uploadPartCopyRes = {
          etag: sanitizeETag(partCopyResult.ETag),
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
    if (!(destObjConfig instanceof CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (sourceFilesLength < 1 || sourceFilesLength > PART_CONSTRAINTS.MAX_PARTS_COUNT) {
      throw new errors.InvalidArgumentError(`"There must be as least one and up to ${PART_CONSTRAINTS.MAX_PARTS_COUNT} source objects.`);
    }
    if (!isFunction(cb)) {
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
      if (!_.isEmpty(srcConfig.VersionID)) {
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
        if (srcCopySize < PART_CONSTRAINTS.ABS_MIN_PART_SIZE && index < sourceFilesLength - 1) {
          throw new errors.InvalidArgumentError(`CopySrcOptions ${index} is too small (${srcCopySize}) and it is not the last part.`);
        }

        // Is data to copy too large?
        totalSize += srcCopySize;
        if (totalSize > PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE) {
          throw new errors.InvalidArgumentError(`Cannot compose an object of size ${totalSize} (> 5TiB)`);
        }

        // record source size
        srcObjectSizes[index] = srcCopySize;

        // calculate parts needed for current source
        totalParts += partsRequired(srcCopySize);
        // Do we need more parts than we are allowed?
        if (totalParts > PART_CONSTRAINTS.MAX_PARTS_COUNT) {
          throw new errors.InvalidArgumentError(`Your proposed compose object requires more than ${PART_CONSTRAINTS.MAX_PARTS_COUNT} parts`);
        }
        return resItemStat;
      });
      if (totalParts === 1 && totalSize <= PART_CONSTRAINTS.MAX_PART_SIZE || totalSize === 0) {
        return this.copyObject(sourceObjList[0], destObjConfig, cb); // use copyObjectV2
      }

      // preserve etag to avoid modification of object while copying.
      for (let i = 0; i < sourceFilesLength; i++) {
        sourceObjList[i].MatchETag = validatedStats[i].etag;
      }
      const splitPartSizeList = validatedStats.map((resItemStat, idx) => {
        const calSize = calculateEvenSplits(srcObjectSizes[idx], sourceObjList[idx]);
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
        async.map(uploadList, me.uploadPartCopy.bind(me), (err, res) => {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!_.isEmpty(selectOpts)) {
      if (!isString(selectOpts.expression)) {
        throw new TypeError('sqlExpression should be of type "string"');
      }
      if (!_.isEmpty(selectOpts.inputSerialization)) {
        if (!isObject(selectOpts.inputSerialization)) {
          throw new TypeError('inputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('inputSerialization is required');
      }
      if (!_.isEmpty(selectOpts.outputSerialization)) {
        if (!isObject(selectOpts.outputSerialization)) {
          throw new TypeError('outputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('outputSerialization is required');
      }
    } else {
      throw new TypeError('valid select configuration is required');
    }
    if (!isFunction(cb)) {
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
    const builder = new xml2js.Builder({
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
      pipesetup(response, transformers.selectObjectContentTransformer()).on('data', data => {
        selectResult = parseSelectObjectContentResponse(data);
      }).on('error', cb).on('end', () => {
        cb(null, selectResult);
      });
    });
  }
}

// Promisify various public-facing APIs on the Client module.
Client.prototype.makeBucket = promisify(Client.prototype.makeBucket);
Client.prototype.bucketExists = promisify(Client.prototype.bucketExists);
Client.prototype.getObject = promisify(Client.prototype.getObject);
Client.prototype.getPartialObject = promisify(Client.prototype.getPartialObject);
Client.prototype.fGetObject = promisify(Client.prototype.fGetObject);
Client.prototype.putObject = promisify(Client.prototype.putObject);
Client.prototype.fPutObject = promisify(Client.prototype.fPutObject);
Client.prototype.copyObject = promisify(Client.prototype.copyObject);
Client.prototype.removeObjects = promisify(Client.prototype.removeObjects);
Client.prototype.presignedUrl = promisify(Client.prototype.presignedUrl);
Client.prototype.presignedGetObject = promisify(Client.prototype.presignedGetObject);
Client.prototype.presignedPutObject = promisify(Client.prototype.presignedPutObject);
Client.prototype.presignedPostPolicy = promisify(Client.prototype.presignedPostPolicy);
Client.prototype.getBucketNotification = promisify(Client.prototype.getBucketNotification);
Client.prototype.setBucketNotification = promisify(Client.prototype.setBucketNotification);
Client.prototype.removeAllBucketNotification = promisify(Client.prototype.removeAllBucketNotification);
Client.prototype.getBucketPolicy = promisify(Client.prototype.getBucketPolicy);
Client.prototype.setBucketPolicy = promisify(Client.prototype.setBucketPolicy);
Client.prototype.removeIncompleteUpload = promisify(Client.prototype.removeIncompleteUpload);
Client.prototype.getBucketVersioning = promisify(Client.prototype.getBucketVersioning);
Client.prototype.setBucketVersioning = promisify(Client.prototype.setBucketVersioning);
Client.prototype.setBucketTagging = promisify(Client.prototype.setBucketTagging);
Client.prototype.removeBucketTagging = promisify(Client.prototype.removeBucketTagging);
Client.prototype.getBucketTagging = promisify(Client.prototype.getBucketTagging);
Client.prototype.setObjectTagging = promisify(Client.prototype.setObjectTagging);
Client.prototype.removeObjectTagging = promisify(Client.prototype.removeObjectTagging);
Client.prototype.getObjectTagging = promisify(Client.prototype.getObjectTagging);
Client.prototype.setBucketLifecycle = promisify(Client.prototype.setBucketLifecycle);
Client.prototype.getBucketLifecycle = promisify(Client.prototype.getBucketLifecycle);
Client.prototype.removeBucketLifecycle = promisify(Client.prototype.removeBucketLifecycle);
Client.prototype.setObjectLockConfig = promisify(Client.prototype.setObjectLockConfig);
Client.prototype.getObjectLockConfig = promisify(Client.prototype.getObjectLockConfig);
Client.prototype.putObjectRetention = promisify(Client.prototype.putObjectRetention);
Client.prototype.getObjectRetention = promisify(Client.prototype.getObjectRetention);
Client.prototype.setBucketEncryption = promisify(Client.prototype.setBucketEncryption);
Client.prototype.getBucketEncryption = promisify(Client.prototype.getBucketEncryption);
Client.prototype.removeBucketEncryption = promisify(Client.prototype.removeBucketEncryption);
Client.prototype.setObjectLegalHold = promisify(Client.prototype.setObjectLegalHold);
Client.prototype.getObjectLegalHold = promisify(Client.prototype.getObjectLegalHold);
Client.prototype.composeObject = promisify(Client.prototype.composeObject);
Client.prototype.selectObjectContent = promisify(Client.prototype.selectObjectContent);

// refactored API use promise internally
Client.prototype.removeObject = callbackify(Client.prototype.removeObject);
Client.prototype.statObject = callbackify(Client.prototype.statObject);
Client.prototype.removeBucket = callbackify(Client.prototype.removeBucket);
Client.prototype.listBuckets = callbackify(Client.prototype.listBuckets);
Client.prototype.removeBucketReplication = callbackify(Client.prototype.removeBucketReplication);
Client.prototype.setBucketReplication = callbackify(Client.prototype.setBucketReplication);
Client.prototype.getBucketReplication = callbackify(Client.prototype.getBucketReplication);
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmcyIsInBhdGgiLCJTdHJlYW0iLCJhc3luYyIsIkJsb2NrU3RyZWFtMiIsIl8iLCJxdWVyeXN0cmluZyIsIlRleHRFbmNvZGVyIiwiWG1sIiwieG1sMmpzIiwiZXJyb3JzIiwiQ29weURlc3RpbmF0aW9uT3B0aW9ucyIsIkNvcHlTb3VyY2VPcHRpb25zIiwiREVGQVVMVF9SRUdJT04iLCJjYWxsYmFja2lmeSIsIlR5cGVkQ2xpZW50IiwiQ29weUNvbmRpdGlvbnMiLCJjYWxjdWxhdGVFdmVuU3BsaXRzIiwiZXh0cmFjdE1ldGFkYXRhIiwiZ2V0U2NvcGUiLCJnZXRTb3VyY2VWZXJzaW9uSWQiLCJnZXRWZXJzaW9uSWQiLCJpbnNlcnRDb250ZW50VHlwZSIsImlzQm9vbGVhbiIsImlzRnVuY3Rpb24iLCJpc051bWJlciIsImlzT2JqZWN0IiwiaXNSZWFkYWJsZVN0cmVhbSIsImlzU3RyaW5nIiwiaXNWYWxpZEJ1Y2tldE5hbWUiLCJpc1ZhbGlkRGF0ZSIsImlzVmFsaWRPYmplY3ROYW1lIiwiaXNWYWxpZFByZWZpeCIsIm1ha2VEYXRlTG9uZyIsIlBBUlRfQ09OU1RSQUlOVFMiLCJwYXJ0c1JlcXVpcmVkIiwicGlwZXNldHVwIiwicHJlcGVuZFhBTVpNZXRhIiwicmVhZGFibGVTdHJlYW0iLCJzYW5pdGl6ZUVUYWciLCJ0b01kNSIsInVyaUVzY2FwZSIsInVyaVJlc291cmNlRXNjYXBlIiwiUG9zdFBvbGljeSIsIkxFR0FMX0hPTERfU1RBVFVTIiwiUkVURU5USU9OX01PREVTIiwiUkVURU5USU9OX1ZBTElESVRZX1VOSVRTIiwiTm90aWZpY2F0aW9uQ29uZmlnIiwiTm90aWZpY2F0aW9uUG9sbGVyIiwiT2JqZWN0VXBsb2FkZXIiLCJwcm9taXNpZnkiLCJwb3N0UHJlc2lnblNpZ25hdHVyZVY0IiwicHJlc2lnblNpZ25hdHVyZVY0IiwidHJhbnNmb3JtZXJzIiwicGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UiLCJDbGllbnQiLCJzZXRBcHBJbmZvIiwiYXBwTmFtZSIsImFwcFZlcnNpb24iLCJUeXBlRXJyb3IiLCJ0cmltIiwiSW52YWxpZEFyZ3VtZW50RXJyb3IiLCJ1c2VyQWdlbnQiLCJjYWxjdWxhdGVQYXJ0U2l6ZSIsInNpemUiLCJtYXhPYmplY3RTaXplIiwib3ZlclJpZGVQYXJ0U2l6ZSIsInBhcnRTaXplIiwibWFrZUJ1Y2tldCIsImJ1Y2tldE5hbWUiLCJyZWdpb24iLCJtYWtlT3B0cyIsImNiIiwiSW52YWxpZEJ1Y2tldE5hbWVFcnJvciIsInBheWxvYWQiLCJjcmVhdGVCdWNrZXRDb25maWd1cmF0aW9uIiwicHVzaCIsIl9hdHRyIiwieG1sbnMiLCJMb2NhdGlvbkNvbnN0cmFpbnQiLCJwYXlsb2FkT2JqZWN0IiwiQ3JlYXRlQnVja2V0Q29uZmlndXJhdGlvbiIsIm1ldGhvZCIsImhlYWRlcnMiLCJPYmplY3RMb2NraW5nIiwicHJvY2Vzc1dpdGhSZXRyeSIsImVyciIsImNvZGUiLCJtYWtlUmVxdWVzdCIsImxpc3RJbmNvbXBsZXRlVXBsb2FkcyIsImJ1Y2tldCIsInByZWZpeCIsInJlY3Vyc2l2ZSIsInVuZGVmaW5lZCIsIkludmFsaWRQcmVmaXhFcnJvciIsImRlbGltaXRlciIsImtleU1hcmtlciIsInVwbG9hZElkTWFya2VyIiwidXBsb2FkcyIsImVuZGVkIiwicmVhZFN0cmVhbSIsIlJlYWRhYmxlIiwib2JqZWN0TW9kZSIsIl9yZWFkIiwibGVuZ3RoIiwic2hpZnQiLCJsaXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeSIsIm9uIiwiZSIsImVtaXQiLCJyZXN1bHQiLCJwcmVmaXhlcyIsImZvckVhY2giLCJlYWNoU2VyaWVzIiwidXBsb2FkIiwibGlzdFBhcnRzIiwia2V5IiwidXBsb2FkSWQiLCJ0aGVuIiwicGFydHMiLCJyZWR1Y2UiLCJhY2MiLCJpdGVtIiwiaXNUcnVuY2F0ZWQiLCJuZXh0S2V5TWFya2VyIiwibmV4dFVwbG9hZElkTWFya2VyIiwiYnVja2V0RXhpc3RzIiwicmVtb3ZlSW5jb21wbGV0ZVVwbG9hZCIsIm9iamVjdE5hbWUiLCJJc1ZhbGlkQnVja2V0TmFtZUVycm9yIiwiSW52YWxpZE9iamVjdE5hbWVFcnJvciIsInJlbW92ZVVwbG9hZElkIiwiZHVyaW5nIiwiZmluZFVwbG9hZElkIiwicXVlcnkiLCJmR2V0T2JqZWN0IiwiZmlsZVBhdGgiLCJnZXRPcHRzIiwicGFydEZpbGUiLCJwYXJ0RmlsZVN0cmVhbSIsIm9ialN0YXQiLCJyZW5hbWUiLCJ3YXRlcmZhbGwiLCJzdGF0T2JqZWN0IiwibWtkaXIiLCJkaXJuYW1lIiwiZXRhZyIsInN0YXQiLCJzdGF0cyIsIm9mZnNldCIsImNyZWF0ZVdyaXRlU3RyZWFtIiwiZmxhZ3MiLCJnZXRQYXJ0aWFsT2JqZWN0IiwiZG93bmxvYWRTdHJlYW0iLCJFcnJvciIsImdldE9iamVjdCIsInJhbmdlIiwiZXhwZWN0ZWRTdGF0dXNDb2RlcyIsInN0cmluZ2lmeSIsImZQdXRPYmplY3QiLCJtZXRhRGF0YSIsImNhbGxiYWNrIiwibHN0YXQiLCJwdXRPYmplY3QiLCJjcmVhdGVSZWFkU3RyZWFtIiwic3RyZWFtIiwiQnVmZmVyIiwiY2h1bmtlciIsInplcm9QYWRkaW5nIiwidXBsb2FkZXIiLCJjb3B5T2JqZWN0VjEiLCJhcmcxIiwiYXJnMiIsImFyZzMiLCJhcmc0IiwiYXJnNSIsInNyY09iamVjdCIsImNvbmRpdGlvbnMiLCJtb2RpZmllZCIsInVubW9kaWZpZWQiLCJtYXRjaEVUYWciLCJtYXRjaEV0YWdFeGNlcHQiLCJtYXRjaEVUYWdFeGNlcHQiLCJyZXNwb25zZSIsInRyYW5zZm9ybWVyIiwiZ2V0Q29weU9iamVjdFRyYW5zZm9ybWVyIiwiZGF0YSIsImNvcHlPYmplY3RWMiIsInNvdXJjZUNvbmZpZyIsImRlc3RDb25maWciLCJ2YWxpZGF0ZSIsIk9iamVjdCIsImFzc2lnbiIsImdldEhlYWRlcnMiLCJCdWNrZXQiLCJyZXNIZWFkZXJzIiwiY29weU9ialJlc3BvbnNlIiwiS2V5IiwiTGFzdE1vZGlmaWVkIiwiTWV0YURhdGEiLCJWZXJzaW9uSWQiLCJTb3VyY2VWZXJzaW9uSWQiLCJFdGFnIiwiU2l6ZSIsImNvcHlPYmplY3QiLCJhbGxBcmdzIiwiYXJndW1lbnRzIiwibGlzdE9iamVjdHNRdWVyeSIsIm1hcmtlciIsImxpc3RRdWVyeU9wdHMiLCJEZWxpbWl0ZXIiLCJNYXhLZXlzIiwiSW5jbHVkZVZlcnNpb24iLCJxdWVyaWVzIiwic29ydCIsImpvaW4iLCJnZXRMaXN0T2JqZWN0c1RyYW5zZm9ybWVyIiwibGlzdE9iamVjdHMiLCJsaXN0T3B0cyIsIm9iamVjdHMiLCJuZXh0TWFya2VyIiwidmVyc2lvbklkTWFya2VyIiwibGlzdE9iamVjdHNWMlF1ZXJ5IiwiY29udGludWF0aW9uVG9rZW4iLCJtYXhLZXlzIiwic3RhcnRBZnRlciIsImdldExpc3RPYmplY3RzVjJUcmFuc2Zvcm1lciIsImxpc3RPYmplY3RzVjIiLCJuZXh0Q29udGludWF0aW9uVG9rZW4iLCJyZW1vdmVPYmplY3RzIiwib2JqZWN0c0xpc3QiLCJBcnJheSIsImlzQXJyYXkiLCJtYXhFbnRyaWVzIiwiZW50cnkiLCJsaXN0IiwibGlzdE9mTGlzdCIsImVuY29kZXIiLCJiYXRjaFJlc3VsdHMiLCJiYXRjaENiIiwidmFsdWUiLCJuYW1lIiwidmVyc2lvbklkIiwiZGVsZXRlT2JqZWN0cyIsIkRlbGV0ZSIsIlF1aWV0IiwiYnVpbGRlciIsIkJ1aWxkZXIiLCJoZWFkbGVzcyIsImJ1aWxkT2JqZWN0IiwiZnJvbSIsImVuY29kZSIsInJlbW92ZU9iamVjdHNSZXN1bHQiLCJyZW1vdmVPYmplY3RzVHJhbnNmb3JtZXIiLCJmbGF0dGVuIiwiZ2V0QnVja2V0UG9saWN5IiwicG9saWN5IiwiZ2V0Q29uY2F0ZXIiLCJ0b1N0cmluZyIsInNldEJ1Y2tldFBvbGljeSIsIkludmFsaWRCdWNrZXRQb2xpY3lFcnJvciIsInByZXNpZ25lZFVybCIsImV4cGlyZXMiLCJyZXFQYXJhbXMiLCJyZXF1ZXN0RGF0ZSIsImFub255bW91cyIsIkFub255bW91c1JlcXVlc3RFcnJvciIsIkRhdGUiLCJnZXRCdWNrZXRSZWdpb24iLCJ1cmwiLCJyZXFPcHRpb25zIiwiZ2V0UmVxdWVzdE9wdGlvbnMiLCJjaGVja0FuZFJlZnJlc2hDcmVkcyIsImFjY2Vzc0tleSIsInNlY3JldEtleSIsInNlc3Npb25Ub2tlbiIsInBlIiwicHJlc2lnbmVkR2V0T2JqZWN0IiwicmVzcEhlYWRlcnMiLCJ2YWxpZFJlc3BIZWFkZXJzIiwiaGVhZGVyIiwicHJlc2lnbmVkUHV0T2JqZWN0IiwibmV3UG9zdFBvbGljeSIsInByZXNpZ25lZFBvc3RQb2xpY3kiLCJwb3N0UG9saWN5IiwiZm9ybURhdGEiLCJkYXRlIiwiZGF0ZVN0ciIsImV4cGlyYXRpb24iLCJzZXRTZWNvbmRzIiwic2V0RXhwaXJlcyIsInBvbGljeUJhc2U2NCIsIkpTT04iLCJzaWduYXR1cmUiLCJvcHRzIiwicG9ydFN0ciIsInBvcnQiLCJ1cmxTdHIiLCJwcm90b2NvbCIsImhvc3QiLCJwb3N0VVJMIiwiY29tcGxldGVNdWx0aXBhcnRVcGxvYWQiLCJldGFncyIsImVsZW1lbnQiLCJQYXJ0IiwiUGFydE51bWJlciIsInBhcnQiLCJFVGFnIiwiQ29tcGxldGVNdWx0aXBhcnRVcGxvYWQiLCJnZXRDb21wbGV0ZU11bHRpcGFydFRyYW5zZm9ybWVyIiwiZXJyQ29kZSIsIlMzRXJyb3IiLCJlcnJNZXNzYWdlIiwiY29tcGxldGVNdWx0aXBhcnRSZXN1bHQiLCJtYXhVcGxvYWRzIiwidW5zaGlmdCIsImdldExpc3RNdWx0aXBhcnRUcmFuc2Zvcm1lciIsImxhdGVzdFVwbG9hZCIsImxpc3ROZXh0IiwiaW5pdGlhdGVkIiwiZ2V0VGltZSIsInNldEJ1Y2tldE5vdGlmaWNhdGlvbiIsImNvbmZpZyIsInJvb3ROYW1lIiwicmVuZGVyT3B0cyIsInByZXR0eSIsInJlbW92ZUFsbEJ1Y2tldE5vdGlmaWNhdGlvbiIsImdldEJ1Y2tldE5vdGlmaWNhdGlvbiIsImdldEJ1Y2tldE5vdGlmaWNhdGlvblRyYW5zZm9ybWVyIiwiYnVja2V0Tm90aWZpY2F0aW9uIiwibGlzdGVuQnVja2V0Tm90aWZpY2F0aW9uIiwic3VmZml4IiwiZXZlbnRzIiwibGlzdGVuZXIiLCJzdGFydCIsImdldEJ1Y2tldFZlcnNpb25pbmciLCJ2ZXJzaW9uQ29uZmlnIiwiYnVja2V0VmVyc2lvbmluZ1RyYW5zZm9ybWVyIiwic2V0QnVja2V0VmVyc2lvbmluZyIsImtleXMiLCJzZXRUYWdnaW5nIiwidGFnZ2luZ1BhcmFtcyIsInRhZ3MiLCJwdXRPcHRzIiwidGFnc0xpc3QiLCJlbnRyaWVzIiwiVmFsdWUiLCJ0YWdnaW5nQ29uZmlnIiwiVGFnZ2luZyIsIlRhZ1NldCIsIlRhZyIsInJlcXVlc3RPcHRpb25zIiwic2V0QnVja2V0VGFnZ2luZyIsInNldE9iamVjdFRhZ2dpbmciLCJyZW1vdmVUYWdnaW5nIiwicmVtb3ZlT3B0cyIsInJlbW92ZUJ1Y2tldFRhZ2dpbmciLCJyZW1vdmVPYmplY3RUYWdnaW5nIiwiZ2V0QnVja2V0VGFnZ2luZyIsImdldFRhZ3NUcmFuc2Zvcm1lciIsImdldE9iamVjdFRhZ2dpbmciLCJhcHBseUJ1Y2tldExpZmVjeWNsZSIsInBvbGljeUNvbmZpZyIsInJlbW92ZUJ1Y2tldExpZmVjeWNsZSIsInNldEJ1Y2tldExpZmVjeWNsZSIsImxpZmVDeWNsZUNvbmZpZyIsImlzRW1wdHkiLCJnZXRCdWNrZXRMaWZlY3ljbGUiLCJsaWZlY3ljbGVUcmFuc2Zvcm1lciIsImxpZmVjeWNsZUNvbmZpZyIsInNldE9iamVjdExvY2tDb25maWciLCJsb2NrQ29uZmlnT3B0cyIsInJldGVudGlvbk1vZGVzIiwiQ09NUExJQU5DRSIsIkdPVkVSTkFOQ0UiLCJ2YWxpZFVuaXRzIiwiREFZUyIsIllFQVJTIiwibW9kZSIsImluY2x1ZGVzIiwidW5pdCIsInZhbGlkaXR5IiwiT2JqZWN0TG9ja0VuYWJsZWQiLCJjb25maWdLZXlzIiwiZGlmZmVyZW5jZSIsIlJ1bGUiLCJEZWZhdWx0UmV0ZW50aW9uIiwiTW9kZSIsIkRheXMiLCJZZWFycyIsImdldE9iamVjdExvY2tDb25maWciLCJvYmplY3RMb2NrQ29uZmlnIiwib2JqZWN0TG9ja1RyYW5zZm9ybWVyIiwicHV0T2JqZWN0UmV0ZW50aW9uIiwicmV0ZW50aW9uT3B0cyIsImdvdmVybmFuY2VCeXBhc3MiLCJyZXRhaW5VbnRpbERhdGUiLCJwYXJhbXMiLCJSZXRhaW5VbnRpbERhdGUiLCJnZXRPYmplY3RSZXRlbnRpb24iLCJyZXRlbnRpb25Db25maWciLCJvYmplY3RSZXRlbnRpb25UcmFuc2Zvcm1lciIsInNldEJ1Y2tldEVuY3J5cHRpb24iLCJlbmNyeXB0aW9uQ29uZmlnIiwiZW5jcnlwdGlvbk9iaiIsIkFwcGx5U2VydmVyU2lkZUVuY3J5cHRpb25CeURlZmF1bHQiLCJTU0VBbGdvcml0aG0iLCJnZXRCdWNrZXRFbmNyeXB0aW9uIiwiYnVja2V0RW5jQ29uZmlnIiwiYnVja2V0RW5jcnlwdGlvblRyYW5zZm9ybWVyIiwicmVtb3ZlQnVja2V0RW5jcnlwdGlvbiIsImdldE9iamVjdExlZ2FsSG9sZCIsImxlZ2FsSG9sZENvbmZpZyIsIm9iamVjdExlZ2FsSG9sZFRyYW5zZm9ybWVyIiwic2V0T2JqZWN0TGVnYWxIb2xkIiwic2V0T3B0cyIsImRlZmF1bHRPcHRzIiwic3RhdHVzIiwiRU5BQkxFRCIsIkRJU0FCTEVEIiwiU3RhdHVzIiwidXBsb2FkUGFydENvcHkiLCJwYXJ0Q29uZmlnIiwidXBsb2FkSUQiLCJwYXJ0TnVtYmVyIiwicGFydENvcHlSZXN1bHQiLCJ1cGxvYWRQYXJ0VHJhbnNmb3JtZXIiLCJ1cGxvYWRQYXJ0Q29weVJlcyIsImNvbXBvc2VPYmplY3QiLCJkZXN0T2JqQ29uZmlnIiwic291cmNlT2JqTGlzdCIsIm1lIiwic291cmNlRmlsZXNMZW5ndGgiLCJNQVhfUEFSVFNfQ09VTlQiLCJpIiwiZ2V0U3RhdE9wdGlvbnMiLCJzcmNDb25maWciLCJzdGF0T3B0cyIsIlZlcnNpb25JRCIsInNyY09iamVjdFNpemVzIiwidG90YWxTaXplIiwidG90YWxQYXJ0cyIsInNvdXJjZU9ialN0YXRzIiwibWFwIiwic3JjSXRlbSIsIlByb21pc2UiLCJhbGwiLCJzcmNPYmplY3RJbmZvcyIsInZhbGlkYXRlZFN0YXRzIiwicmVzSXRlbVN0YXQiLCJpbmRleCIsInNyY0NvcHlTaXplIiwiTWF0Y2hSYW5nZSIsInNyY1N0YXJ0IiwiU3RhcnQiLCJzcmNFbmQiLCJFbmQiLCJBQlNfTUlOX1BBUlRfU0laRSIsIk1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFIiwiTUFYX1BBUlRfU0laRSIsIk1hdGNoRVRhZyIsInNwbGl0UGFydFNpemVMaXN0IiwiaWR4IiwiY2FsU2l6ZSIsImdldFVwbG9hZFBhcnRDb25maWdMaXN0IiwidXBsb2FkUGFydENvbmZpZ0xpc3QiLCJzcGxpdFNpemUiLCJzcGxpdEluZGV4Iiwic3RhcnRJbmRleCIsInN0YXJ0SWR4IiwiZW5kSW5kZXgiLCJlbmRJZHgiLCJvYmpJbmZvIiwib2JqQ29uZmlnIiwicGFydEluZGV4IiwidG90YWxVcGxvYWRzIiwic3BsaXRTdGFydCIsInVwbGRDdHJJZHgiLCJzcGxpdEVuZCIsInNvdXJjZU9iaiIsInVwbG9hZFBhcnRDb25maWciLCJwZXJmb3JtVXBsb2FkUGFydHMiLCJ1cGxvYWRMaXN0IiwiYmluZCIsInJlcyIsImFib3J0TXVsdGlwYXJ0VXBsb2FkIiwicGFydHNEb25lIiwicGFydENvcHkiLCJuZXdVcGxvYWRIZWFkZXJzIiwiaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQiLCJjYXRjaCIsImVycm9yIiwic2VsZWN0T2JqZWN0Q29udGVudCIsInNlbGVjdE9wdHMiLCJleHByZXNzaW9uIiwiaW5wdXRTZXJpYWxpemF0aW9uIiwib3V0cHV0U2VyaWFsaXphdGlvbiIsIkV4cHJlc3Npb24iLCJFeHByZXNzaW9uVHlwZSIsImV4cHJlc3Npb25UeXBlIiwiSW5wdXRTZXJpYWxpemF0aW9uIiwiT3V0cHV0U2VyaWFsaXphdGlvbiIsInJlcXVlc3RQcm9ncmVzcyIsIlJlcXVlc3RQcm9ncmVzcyIsInNjYW5SYW5nZSIsIlNjYW5SYW5nZSIsInNlbGVjdFJlc3VsdCIsInNlbGVjdE9iamVjdENvbnRlbnRUcmFuc2Zvcm1lciIsInByb3RvdHlwZSIsInJlbW92ZU9iamVjdCIsInJlbW92ZUJ1Y2tldCIsImxpc3RCdWNrZXRzIiwicmVtb3ZlQnVja2V0UmVwbGljYXRpb24iLCJzZXRCdWNrZXRSZXBsaWNhdGlvbiIsImdldEJ1Y2tldFJlcGxpY2F0aW9uIl0sInNvdXJjZXMiOlsibWluaW8uanMiXSwic291cmNlc0NvbnRlbnQiOlsiLypcbiAqIE1pbklPIEphdmFzY3JpcHQgTGlicmFyeSBmb3IgQW1hem9uIFMzIENvbXBhdGlibGUgQ2xvdWQgU3RvcmFnZSwgKEMpIDIwMTUgTWluSU8sIEluYy5cbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcydcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAnbm9kZTpwYXRoJ1xuaW1wb3J0ICogYXMgU3RyZWFtIGZyb20gJ25vZGU6c3RyZWFtJ1xuXG5pbXBvcnQgYXN5bmMgZnJvbSAnYXN5bmMnXG5pbXBvcnQgQmxvY2tTdHJlYW0yIGZyb20gJ2Jsb2NrLXN0cmVhbTInXG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnXG5pbXBvcnQgKiBhcyBxdWVyeXN0cmluZyBmcm9tICdxdWVyeS1zdHJpbmcnXG5pbXBvcnQgeyBUZXh0RW5jb2RlciB9IGZyb20gJ3dlYi1lbmNvZGluZydcbmltcG9ydCBYbWwgZnJvbSAneG1sJ1xuaW1wb3J0IHhtbDJqcyBmcm9tICd4bWwyanMnXG5cbmltcG9ydCAqIGFzIGVycm9ycyBmcm9tICcuL2Vycm9ycy50cydcbmltcG9ydCB7IENvcHlEZXN0aW5hdGlvbk9wdGlvbnMsIENvcHlTb3VyY2VPcHRpb25zLCBERUZBVUxUX1JFR0lPTiB9IGZyb20gJy4vaGVscGVycy50cydcbmltcG9ydCB7IGNhbGxiYWNraWZ5IH0gZnJvbSAnLi9pbnRlcm5hbC9jYWxsYmFja2lmeS5qcydcbmltcG9ydCB7IFR5cGVkQ2xpZW50IH0gZnJvbSAnLi9pbnRlcm5hbC9jbGllbnQudHMnXG5pbXBvcnQgeyBDb3B5Q29uZGl0aW9ucyB9IGZyb20gJy4vaW50ZXJuYWwvY29weS1jb25kaXRpb25zLnRzJ1xuaW1wb3J0IHtcbiAgY2FsY3VsYXRlRXZlblNwbGl0cyxcbiAgZXh0cmFjdE1ldGFkYXRhLFxuICBnZXRTY29wZSxcbiAgZ2V0U291cmNlVmVyc2lvbklkLFxuICBnZXRWZXJzaW9uSWQsXG4gIGluc2VydENvbnRlbnRUeXBlLFxuICBpc0Jvb2xlYW4sXG4gIGlzRnVuY3Rpb24sXG4gIGlzTnVtYmVyLFxuICBpc09iamVjdCxcbiAgaXNSZWFkYWJsZVN0cmVhbSxcbiAgaXNTdHJpbmcsXG4gIGlzVmFsaWRCdWNrZXROYW1lLFxuICBpc1ZhbGlkRGF0ZSxcbiAgaXNWYWxpZE9iamVjdE5hbWUsXG4gIGlzVmFsaWRQcmVmaXgsXG4gIG1ha2VEYXRlTG9uZyxcbiAgUEFSVF9DT05TVFJBSU5UUyxcbiAgcGFydHNSZXF1aXJlZCxcbiAgcGlwZXNldHVwLFxuICBwcmVwZW5kWEFNWk1ldGEsXG4gIHJlYWRhYmxlU3RyZWFtLFxuICBzYW5pdGl6ZUVUYWcsXG4gIHRvTWQ1LFxuICB1cmlFc2NhcGUsXG4gIHVyaVJlc291cmNlRXNjYXBlLFxufSBmcm9tICcuL2ludGVybmFsL2hlbHBlci50cydcbmltcG9ydCB7IFBvc3RQb2xpY3kgfSBmcm9tICcuL2ludGVybmFsL3Bvc3QtcG9saWN5LnRzJ1xuaW1wb3J0IHsgTEVHQUxfSE9MRF9TVEFUVVMsIFJFVEVOVElPTl9NT0RFUywgUkVURU5USU9OX1ZBTElESVRZX1VOSVRTIH0gZnJvbSAnLi9pbnRlcm5hbC90eXBlLnRzJ1xuaW1wb3J0IHsgTm90aWZpY2F0aW9uQ29uZmlnLCBOb3RpZmljYXRpb25Qb2xsZXIgfSBmcm9tICcuL25vdGlmaWNhdGlvbi5qcydcbmltcG9ydCB7IE9iamVjdFVwbG9hZGVyIH0gZnJvbSAnLi9vYmplY3QtdXBsb2FkZXIuanMnXG5pbXBvcnQgeyBwcm9taXNpZnkgfSBmcm9tICcuL3Byb21pc2lmeS5qcydcbmltcG9ydCB7IHBvc3RQcmVzaWduU2lnbmF0dXJlVjQsIHByZXNpZ25TaWduYXR1cmVWNCB9IGZyb20gJy4vc2lnbmluZy50cydcbmltcG9ydCAqIGFzIHRyYW5zZm9ybWVycyBmcm9tICcuL3RyYW5zZm9ybWVycy5qcydcbmltcG9ydCB7IHBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlIH0gZnJvbSAnLi94bWwtcGFyc2Vycy5qcydcblxuZXhwb3J0ICogZnJvbSAnLi9oZWxwZXJzLnRzJ1xuZXhwb3J0ICogZnJvbSAnLi9ub3RpZmljYXRpb24uanMnXG5leHBvcnQgeyBDb3B5Q29uZGl0aW9ucywgUG9zdFBvbGljeSB9XG5cbmV4cG9ydCBjbGFzcyBDbGllbnQgZXh0ZW5kcyBUeXBlZENsaWVudCB7XG4gIC8vIFNldCBhcHBsaWNhdGlvbiBzcGVjaWZpYyBpbmZvcm1hdGlvbi5cbiAgLy9cbiAgLy8gR2VuZXJhdGVzIFVzZXItQWdlbnQgaW4gdGhlIGZvbGxvd2luZyBzdHlsZS5cbiAgLy9cbiAgLy8gICAgICAgTWluSU8gKE9TOyBBUkNIKSBMSUIvVkVSIEFQUC9WRVJcbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBhcHBOYW1lYCBfc3RyaW5nXyAtIEFwcGxpY2F0aW9uIG5hbWUuXG4gIC8vICogYGFwcFZlcnNpb25gIF9zdHJpbmdfIC0gQXBwbGljYXRpb24gdmVyc2lvbi5cbiAgc2V0QXBwSW5mbyhhcHBOYW1lLCBhcHBWZXJzaW9uKSB7XG4gICAgaWYgKCFpc1N0cmluZyhhcHBOYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgSW52YWxpZCBhcHBOYW1lOiAke2FwcE5hbWV9YClcbiAgICB9XG4gICAgaWYgKGFwcE5hbWUudHJpbSgpID09PSAnJykge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW5wdXQgYXBwTmFtZSBjYW5ub3QgYmUgZW1wdHkuJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhhcHBWZXJzaW9uKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgSW52YWxpZCBhcHBWZXJzaW9uOiAke2FwcFZlcnNpb259YClcbiAgICB9XG4gICAgaWYgKGFwcFZlcnNpb24udHJpbSgpID09PSAnJykge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW5wdXQgYXBwVmVyc2lvbiBjYW5ub3QgYmUgZW1wdHkuJylcbiAgICB9XG4gICAgdGhpcy51c2VyQWdlbnQgPSBgJHt0aGlzLnVzZXJBZ2VudH0gJHthcHBOYW1lfS8ke2FwcFZlcnNpb259YFxuICB9XG5cbiAgLy8gQ2FsY3VsYXRlIHBhcnQgc2l6ZSBnaXZlbiB0aGUgb2JqZWN0IHNpemUuIFBhcnQgc2l6ZSB3aWxsIGJlIGF0bGVhc3QgdGhpcy5wYXJ0U2l6ZVxuICBjYWxjdWxhdGVQYXJ0U2l6ZShzaXplKSB7XG4gICAgaWYgKCFpc051bWJlcihzaXplKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc2l6ZSBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG4gICAgaWYgKHNpemUgPiB0aGlzLm1heE9iamVjdFNpemUpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYHNpemUgc2hvdWxkIG5vdCBiZSBtb3JlIHRoYW4gJHt0aGlzLm1heE9iamVjdFNpemV9YClcbiAgICB9XG4gICAgaWYgKHRoaXMub3ZlclJpZGVQYXJ0U2l6ZSkge1xuICAgICAgcmV0dXJuIHRoaXMucGFydFNpemVcbiAgICB9XG4gICAgdmFyIHBhcnRTaXplID0gdGhpcy5wYXJ0U2l6ZVxuICAgIGZvciAoOzspIHtcbiAgICAgIC8vIHdoaWxlKHRydWUpIHsuLi59IHRocm93cyBsaW50aW5nIGVycm9yLlxuICAgICAgLy8gSWYgcGFydFNpemUgaXMgYmlnIGVub3VnaCB0byBhY2NvbW9kYXRlIHRoZSBvYmplY3Qgc2l6ZSwgdGhlbiB1c2UgaXQuXG4gICAgICBpZiAocGFydFNpemUgKiAxMDAwMCA+IHNpemUpIHtcbiAgICAgICAgcmV0dXJuIHBhcnRTaXplXG4gICAgICB9XG4gICAgICAvLyBUcnkgcGFydCBzaXplcyBhcyA2NE1CLCA4ME1CLCA5Nk1CIGV0Yy5cbiAgICAgIHBhcnRTaXplICs9IDE2ICogMTAyNCAqIDEwMjRcbiAgICB9XG4gIH1cblxuICAvLyBDcmVhdGVzIHRoZSBidWNrZXQgYGJ1Y2tldE5hbWVgLlxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfIC0gTmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYHJlZ2lvbmAgX3N0cmluZ18gLSByZWdpb24gdmFsaWQgdmFsdWVzIGFyZSBfdXMtd2VzdC0xXywgX3VzLXdlc3QtMl8sICBfZXUtd2VzdC0xXywgX2V1LWNlbnRyYWwtMV8sIF9hcC1zb3V0aGVhc3QtMV8sIF9hcC1ub3J0aGVhc3QtMV8sIF9hcC1zb3V0aGVhc3QtMl8sIF9zYS1lYXN0LTFfLlxuICAvLyAqIGBtYWtlT3B0c2AgX29iamVjdF8gLSBPcHRpb25zIHRvIGNyZWF0ZSBhIGJ1Y2tldC4gZS5nIHtPYmplY3RMb2NraW5nOnRydWV9IChPcHRpb25hbClcbiAgLy8gKiBgY2FsbGJhY2soZXJyKWAgX2Z1bmN0aW9uXyAtIGNhbGxiYWNrIGZ1bmN0aW9uIHdpdGggYGVycmAgYXMgdGhlIGVycm9yIGFyZ3VtZW50LiBgZXJyYCBpcyBudWxsIGlmIHRoZSBidWNrZXQgaXMgc3VjY2Vzc2Z1bGx5IGNyZWF0ZWQuXG4gIG1ha2VCdWNrZXQoYnVja2V0TmFtZSwgcmVnaW9uLCBtYWtlT3B0cyA9IHt9LCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIC8vIEJhY2t3YXJkIENvbXBhdGliaWxpdHlcbiAgICBpZiAoaXNPYmplY3QocmVnaW9uKSkge1xuICAgICAgY2IgPSBtYWtlT3B0c1xuICAgICAgbWFrZU9wdHMgPSByZWdpb25cbiAgICAgIHJlZ2lvbiA9ICcnXG4gICAgfVxuICAgIGlmIChpc0Z1bmN0aW9uKHJlZ2lvbikpIHtcbiAgICAgIGNiID0gcmVnaW9uXG4gICAgICByZWdpb24gPSAnJ1xuICAgICAgbWFrZU9wdHMgPSB7fVxuICAgIH1cbiAgICBpZiAoaXNGdW5jdGlvbihtYWtlT3B0cykpIHtcbiAgICAgIGNiID0gbWFrZU9wdHNcbiAgICAgIG1ha2VPcHRzID0ge31cbiAgICB9XG5cbiAgICBpZiAoIWlzU3RyaW5nKHJlZ2lvbikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlZ2lvbiBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChtYWtlT3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21ha2VPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cblxuICAgIHZhciBwYXlsb2FkID0gJydcblxuICAgIC8vIFJlZ2lvbiBhbHJlYWR5IHNldCBpbiBjb25zdHJ1Y3RvciwgdmFsaWRhdGUgaWZcbiAgICAvLyBjYWxsZXIgcmVxdWVzdGVkIGJ1Y2tldCBsb2NhdGlvbiBpcyBzYW1lLlxuICAgIGlmIChyZWdpb24gJiYgdGhpcy5yZWdpb24pIHtcbiAgICAgIGlmIChyZWdpb24gIT09IHRoaXMucmVnaW9uKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYENvbmZpZ3VyZWQgcmVnaW9uICR7dGhpcy5yZWdpb259LCByZXF1ZXN0ZWQgJHtyZWdpb259YClcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gc2VuZGluZyBtYWtlQnVja2V0IHJlcXVlc3Qgd2l0aCBYTUwgY29udGFpbmluZyAndXMtZWFzdC0xJyBmYWlscy4gRm9yXG4gICAgLy8gZGVmYXVsdCByZWdpb24gc2VydmVyIGV4cGVjdHMgdGhlIHJlcXVlc3Qgd2l0aG91dCBib2R5XG4gICAgaWYgKHJlZ2lvbiAmJiByZWdpb24gIT09IERFRkFVTFRfUkVHSU9OKSB7XG4gICAgICB2YXIgY3JlYXRlQnVja2V0Q29uZmlndXJhdGlvbiA9IFtdXG4gICAgICBjcmVhdGVCdWNrZXRDb25maWd1cmF0aW9uLnB1c2goe1xuICAgICAgICBfYXR0cjoge1xuICAgICAgICAgIHhtbG5zOiAnaHR0cDovL3MzLmFtYXpvbmF3cy5jb20vZG9jLzIwMDYtMDMtMDEvJyxcbiAgICAgICAgfSxcbiAgICAgIH0pXG4gICAgICBjcmVhdGVCdWNrZXRDb25maWd1cmF0aW9uLnB1c2goe1xuICAgICAgICBMb2NhdGlvbkNvbnN0cmFpbnQ6IHJlZ2lvbixcbiAgICAgIH0pXG4gICAgICB2YXIgcGF5bG9hZE9iamVjdCA9IHtcbiAgICAgICAgQ3JlYXRlQnVja2V0Q29uZmlndXJhdGlvbjogY3JlYXRlQnVja2V0Q29uZmlndXJhdGlvbixcbiAgICAgIH1cbiAgICAgIHBheWxvYWQgPSBYbWwocGF5bG9hZE9iamVjdClcbiAgICB9XG4gICAgdmFyIG1ldGhvZCA9ICdQVVQnXG4gICAgdmFyIGhlYWRlcnMgPSB7fVxuXG4gICAgaWYgKG1ha2VPcHRzLk9iamVjdExvY2tpbmcpIHtcbiAgICAgIGhlYWRlcnNbJ3gtYW16LWJ1Y2tldC1vYmplY3QtbG9jay1lbmFibGVkJ10gPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKCFyZWdpb24pIHtcbiAgICAgIHJlZ2lvbiA9IERFRkFVTFRfUkVHSU9OXG4gICAgfVxuXG4gICAgY29uc3QgcHJvY2Vzc1dpdGhSZXRyeSA9IChlcnIpID0+IHtcbiAgICAgIGlmIChlcnIgJiYgKHJlZ2lvbiA9PT0gJycgfHwgcmVnaW9uID09PSBERUZBVUxUX1JFR0lPTikpIHtcbiAgICAgICAgaWYgKGVyci5jb2RlID09PSAnQXV0aG9yaXphdGlvbkhlYWRlck1hbGZvcm1lZCcgJiYgZXJyLnJlZ2lvbiAhPT0gJycpIHtcbiAgICAgICAgICAvLyBSZXRyeSB3aXRoIHJlZ2lvbiByZXR1cm5lZCBhcyBwYXJ0IG9mIGVycm9yXG4gICAgICAgICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgaGVhZGVycyB9LCBwYXlsb2FkLCBbMjAwXSwgZXJyLnJlZ2lvbiwgZmFsc2UsIGNiKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBjYiAmJiBjYihlcnIpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBjYiAmJiBjYihlcnIpXG4gICAgfVxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIGhlYWRlcnMgfSwgcGF5bG9hZCwgWzIwMF0sIHJlZ2lvbiwgZmFsc2UsIHByb2Nlc3NXaXRoUmV0cnkpXG4gIH1cblxuICAvLyBSZXR1cm5zIGEgc3RyZWFtIHRoYXQgZW1pdHMgb2JqZWN0cyB0aGF0IGFyZSBwYXJ0aWFsbHkgdXBsb2FkZWQuXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBwcmVmaXhgIF9zdHJpbmdfOiBwcmVmaXggb2YgdGhlIG9iamVjdCBuYW1lcyB0aGF0IGFyZSBwYXJ0aWFsbHkgdXBsb2FkZWQgKG9wdGlvbmFsLCBkZWZhdWx0IGAnJ2ApXG4gIC8vICogYHJlY3Vyc2l2ZWAgX2Jvb2xfOiBkaXJlY3Rvcnkgc3R5bGUgbGlzdGluZyB3aGVuIGZhbHNlLCByZWN1cnNpdmUgbGlzdGluZyB3aGVuIHRydWUgKG9wdGlvbmFsLCBkZWZhdWx0IGBmYWxzZWApXG4gIC8vXG4gIC8vIF9fUmV0dXJuIFZhbHVlX19cbiAgLy8gKiBgc3RyZWFtYCBfU3RyZWFtXyA6IGVtaXRzIG9iamVjdHMgb2YgdGhlIGZvcm1hdDpcbiAgLy8gICAqIGBvYmplY3Qua2V5YCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0XG4gIC8vICAgKiBgb2JqZWN0LnVwbG9hZElkYCBfc3RyaW5nXzogdXBsb2FkIElEIG9mIHRoZSBvYmplY3RcbiAgLy8gICAqIGBvYmplY3Quc2l6ZWAgX0ludGVnZXJfOiBzaXplIG9mIHRoZSBwYXJ0aWFsbHkgdXBsb2FkZWQgb2JqZWN0XG4gIGxpc3RJbmNvbXBsZXRlVXBsb2FkcyhidWNrZXQsIHByZWZpeCwgcmVjdXJzaXZlKSB7XG4gICAgaWYgKHByZWZpeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwcmVmaXggPSAnJ1xuICAgIH1cbiAgICBpZiAocmVjdXJzaXZlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJlY3Vyc2l2ZSA9IGZhbHNlXG4gICAgfVxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0KVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRQcmVmaXgocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkUHJlZml4RXJyb3IoYEludmFsaWQgcHJlZml4IDogJHtwcmVmaXh9YClcbiAgICB9XG4gICAgaWYgKCFpc0Jvb2xlYW4ocmVjdXJzaXZlKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVjdXJzaXZlIHNob3VsZCBiZSBvZiB0eXBlIFwiYm9vbGVhblwiJylcbiAgICB9XG4gICAgdmFyIGRlbGltaXRlciA9IHJlY3Vyc2l2ZSA/ICcnIDogJy8nXG4gICAgdmFyIGtleU1hcmtlciA9ICcnXG4gICAgdmFyIHVwbG9hZElkTWFya2VyID0gJydcbiAgICB2YXIgdXBsb2FkcyA9IFtdXG4gICAgdmFyIGVuZGVkID0gZmFsc2VcbiAgICB2YXIgcmVhZFN0cmVhbSA9IFN0cmVhbS5SZWFkYWJsZSh7IG9iamVjdE1vZGU6IHRydWUgfSlcbiAgICByZWFkU3RyZWFtLl9yZWFkID0gKCkgPT4ge1xuICAgICAgLy8gcHVzaCBvbmUgdXBsb2FkIGluZm8gcGVyIF9yZWFkKClcbiAgICAgIGlmICh1cGxvYWRzLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKHVwbG9hZHMuc2hpZnQoKSlcbiAgICAgIH1cbiAgICAgIGlmIChlbmRlZCkge1xuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKG51bGwpXG4gICAgICB9XG4gICAgICB0aGlzLmxpc3RJbmNvbXBsZXRlVXBsb2Fkc1F1ZXJ5KGJ1Y2tldCwgcHJlZml4LCBrZXlNYXJrZXIsIHVwbG9hZElkTWFya2VyLCBkZWxpbWl0ZXIpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gcmVhZFN0cmVhbS5lbWl0KCdlcnJvcicsIGUpKVxuICAgICAgICAub24oJ2RhdGEnLCAocmVzdWx0KSA9PiB7XG4gICAgICAgICAgcmVzdWx0LnByZWZpeGVzLmZvckVhY2goKHByZWZpeCkgPT4gdXBsb2Fkcy5wdXNoKHByZWZpeCkpXG4gICAgICAgICAgYXN5bmMuZWFjaFNlcmllcyhcbiAgICAgICAgICAgIHJlc3VsdC51cGxvYWRzLFxuICAgICAgICAgICAgKHVwbG9hZCwgY2IpID0+IHtcbiAgICAgICAgICAgICAgLy8gZm9yIGVhY2ggaW5jb21wbGV0ZSB1cGxvYWQgYWRkIHRoZSBzaXplcyBvZiBpdHMgdXBsb2FkZWQgcGFydHNcbiAgICAgICAgICAgICAgdGhpcy5saXN0UGFydHMoYnVja2V0LCB1cGxvYWQua2V5LCB1cGxvYWQudXBsb2FkSWQpLnRoZW4oKHBhcnRzKSA9PiB7XG4gICAgICAgICAgICAgICAgdXBsb2FkLnNpemUgPSBwYXJ0cy5yZWR1Y2UoKGFjYywgaXRlbSkgPT4gYWNjICsgaXRlbS5zaXplLCAwKVxuICAgICAgICAgICAgICAgIHVwbG9hZHMucHVzaCh1cGxvYWQpXG4gICAgICAgICAgICAgICAgY2IoKVxuICAgICAgICAgICAgICB9LCBjYilcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAoZXJyKSA9PiB7XG4gICAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgICByZWFkU3RyZWFtLmVtaXQoJ2Vycm9yJywgZXJyKVxuICAgICAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGlmIChyZXN1bHQuaXNUcnVuY2F0ZWQpIHtcbiAgICAgICAgICAgICAgICBrZXlNYXJrZXIgPSByZXN1bHQubmV4dEtleU1hcmtlclxuICAgICAgICAgICAgICAgIHVwbG9hZElkTWFya2VyID0gcmVzdWx0Lm5leHRVcGxvYWRJZE1hcmtlclxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGVuZGVkID0gdHJ1ZVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJlYWRTdHJlYW0uX3JlYWQoKVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICApXG4gICAgICAgIH0pXG4gICAgfVxuICAgIHJldHVybiByZWFkU3RyZWFtXG4gIH1cblxuICAvLyBUbyBjaGVjayBpZiBhIGJ1Y2tldCBhbHJlYWR5IGV4aXN0cy5cbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXyA6IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBjYWxsYmFjayhlcnIpYCBfZnVuY3Rpb25fIDogYGVycmAgaXMgYG51bGxgIGlmIHRoZSBidWNrZXQgZXhpc3RzXG4gIGJ1Y2tldEV4aXN0cyhidWNrZXROYW1lLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIHZhciBtZXRob2QgPSAnSEVBRCdcbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lIH0sICcnLCBbMjAwXSwgJycsIGZhbHNlLCAoZXJyKSA9PiB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGlmIChlcnIuY29kZSA9PSAnTm9TdWNoQnVja2V0JyB8fCBlcnIuY29kZSA9PSAnTm90Rm91bmQnKSB7XG4gICAgICAgICAgcmV0dXJuIGNiKG51bGwsIGZhbHNlKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBjYihlcnIpXG4gICAgICB9XG4gICAgICBjYihudWxsLCB0cnVlKVxuICAgIH0pXG4gIH1cblxuICAvLyBSZW1vdmUgdGhlIHBhcnRpYWxseSB1cGxvYWRlZCBvYmplY3QuXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBvYmplY3ROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0XG4gIC8vICogYGNhbGxiYWNrKGVycilgIF9mdW5jdGlvbl86IGNhbGxiYWNrIGZ1bmN0aW9uIGlzIGNhbGxlZCB3aXRoIG5vbiBgbnVsbGAgdmFsdWUgaW4gY2FzZSBvZiBlcnJvclxuICByZW1vdmVJbmNvbXBsZXRlVXBsb2FkKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5Jc1ZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG4gICAgdmFyIHJlbW92ZVVwbG9hZElkXG4gICAgYXN5bmMuZHVyaW5nKFxuICAgICAgKGNiKSA9PiB7XG4gICAgICAgIHRoaXMuZmluZFVwbG9hZElkKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIChlLCB1cGxvYWRJZCkgPT4ge1xuICAgICAgICAgIGlmIChlKSB7XG4gICAgICAgICAgICByZXR1cm4gY2IoZSlcbiAgICAgICAgICB9XG4gICAgICAgICAgcmVtb3ZlVXBsb2FkSWQgPSB1cGxvYWRJZFxuICAgICAgICAgIGNiKG51bGwsIHVwbG9hZElkKVxuICAgICAgICB9KVxuICAgICAgfSxcbiAgICAgIChjYikgPT4ge1xuICAgICAgICB2YXIgbWV0aG9kID0gJ0RFTEVURSdcbiAgICAgICAgdmFyIHF1ZXJ5ID0gYHVwbG9hZElkPSR7cmVtb3ZlVXBsb2FkSWR9YFxuICAgICAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9LCAnJywgWzIwNF0sICcnLCBmYWxzZSwgKGUpID0+IGNiKGUpKVxuICAgICAgfSxcbiAgICAgIGNiLFxuICAgIClcbiAgfVxuXG4gIC8vIENhbGxiYWNrIGlzIGNhbGxlZCB3aXRoIGBlcnJvcmAgaW4gY2FzZSBvZiBlcnJvciBvciBgbnVsbGAgaW4gY2FzZSBvZiBzdWNjZXNzXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBvYmplY3ROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0XG4gIC8vICogYGZpbGVQYXRoYCBfc3RyaW5nXzogcGF0aCB0byB3aGljaCB0aGUgb2JqZWN0IGRhdGEgd2lsbCBiZSB3cml0dGVuIHRvXG4gIC8vICogYGdldE9wdHNgIF9vYmplY3RfOiBWZXJzaW9uIG9mIHRoZSBvYmplY3QgaW4gdGhlIGZvcm0gYHt2ZXJzaW9uSWQ6J215LXV1aWQnfWAuIERlZmF1bHQgaXMgYHt9YC4gKG9wdGlvbmFsKVxuICAvLyAqIGBjYWxsYmFjayhlcnIpYCBfZnVuY3Rpb25fOiBjYWxsYmFjayBpcyBjYWxsZWQgd2l0aCBgZXJyYCBpbiBjYXNlIG9mIGVycm9yLlxuICBmR2V0T2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGZpbGVQYXRoLCBnZXRPcHRzID0ge30sIGNiKSB7XG4gICAgLy8gSW5wdXQgdmFsaWRhdGlvbi5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGZpbGVQYXRoKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZmlsZVBhdGggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIC8vIEJhY2t3YXJkIENvbXBhdGliaWxpdHlcbiAgICBpZiAoaXNGdW5jdGlvbihnZXRPcHRzKSkge1xuICAgICAgY2IgPSBnZXRPcHRzXG4gICAgICBnZXRPcHRzID0ge31cbiAgICB9XG5cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cblxuICAgIC8vIEludGVybmFsIGRhdGEuXG4gICAgdmFyIHBhcnRGaWxlXG4gICAgdmFyIHBhcnRGaWxlU3RyZWFtXG4gICAgdmFyIG9ialN0YXRcblxuICAgIC8vIFJlbmFtZSB3cmFwcGVyLlxuICAgIHZhciByZW5hbWUgPSAoZXJyKSA9PiB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIHJldHVybiBjYihlcnIpXG4gICAgICB9XG4gICAgICBmcy5yZW5hbWUocGFydEZpbGUsIGZpbGVQYXRoLCBjYilcbiAgICB9XG5cbiAgICBhc3luYy53YXRlcmZhbGwoXG4gICAgICBbXG4gICAgICAgIChjYikgPT4gdGhpcy5zdGF0T2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGdldE9wdHMsIGNiKSxcbiAgICAgICAgKHJlc3VsdCwgY2IpID0+IHtcbiAgICAgICAgICBvYmpTdGF0ID0gcmVzdWx0XG4gICAgICAgICAgLy8gQ3JlYXRlIGFueSBtaXNzaW5nIHRvcCBsZXZlbCBkaXJlY3Rvcmllcy5cbiAgICAgICAgICBmcy5ta2RpcihwYXRoLmRpcm5hbWUoZmlsZVBhdGgpLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9LCAoZXJyKSA9PiBjYihlcnIpKVxuICAgICAgICB9LFxuICAgICAgICAoY2IpID0+IHtcbiAgICAgICAgICBwYXJ0RmlsZSA9IGAke2ZpbGVQYXRofS4ke29ialN0YXQuZXRhZ30ucGFydC5taW5pb2BcbiAgICAgICAgICBmcy5zdGF0KHBhcnRGaWxlLCAoZSwgc3RhdHMpID0+IHtcbiAgICAgICAgICAgIHZhciBvZmZzZXQgPSAwXG4gICAgICAgICAgICBpZiAoZSkge1xuICAgICAgICAgICAgICBwYXJ0RmlsZVN0cmVhbSA9IGZzLmNyZWF0ZVdyaXRlU3RyZWFtKHBhcnRGaWxlLCB7IGZsYWdzOiAndycgfSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGlmIChvYmpTdGF0LnNpemUgPT09IHN0YXRzLnNpemUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVuYW1lKClcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBvZmZzZXQgPSBzdGF0cy5zaXplXG4gICAgICAgICAgICAgIHBhcnRGaWxlU3RyZWFtID0gZnMuY3JlYXRlV3JpdGVTdHJlYW0ocGFydEZpbGUsIHsgZmxhZ3M6ICdhJyB9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5nZXRQYXJ0aWFsT2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIG9mZnNldCwgMCwgZ2V0T3B0cywgY2IpXG4gICAgICAgICAgfSlcbiAgICAgICAgfSxcbiAgICAgICAgKGRvd25sb2FkU3RyZWFtLCBjYikgPT4ge1xuICAgICAgICAgIHBpcGVzZXR1cChkb3dubG9hZFN0cmVhbSwgcGFydEZpbGVTdHJlYW0pXG4gICAgICAgICAgICAub24oJ2Vycm9yJywgKGUpID0+IGNiKGUpKVxuICAgICAgICAgICAgLm9uKCdmaW5pc2gnLCBjYilcbiAgICAgICAgfSxcbiAgICAgICAgKGNiKSA9PiBmcy5zdGF0KHBhcnRGaWxlLCBjYiksXG4gICAgICAgIChzdGF0cywgY2IpID0+IHtcbiAgICAgICAgICBpZiAoc3RhdHMuc2l6ZSA9PT0gb2JqU3RhdC5zaXplKSB7XG4gICAgICAgICAgICByZXR1cm4gY2IoKVxuICAgICAgICAgIH1cbiAgICAgICAgICBjYihuZXcgRXJyb3IoJ1NpemUgbWlzbWF0Y2ggYmV0d2VlbiBkb3dubG9hZGVkIGZpbGUgYW5kIHRoZSBvYmplY3QnKSlcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICByZW5hbWUsXG4gICAgKVxuICB9XG5cbiAgLy8gQ2FsbGJhY2sgaXMgY2FsbGVkIHdpdGggcmVhZGFibGUgc3RyZWFtIG9mIHRoZSBvYmplY3QgY29udGVudC5cbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYG9iamVjdE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBvYmplY3RcbiAgLy8gKiBgZ2V0T3B0c2AgX29iamVjdF86IFZlcnNpb24gb2YgdGhlIG9iamVjdCBpbiB0aGUgZm9ybSBge3ZlcnNpb25JZDonbXktdXVpZCd9YC4gRGVmYXVsdCBpcyBge31gLiAob3B0aW9uYWwpXG4gIC8vICogYGNhbGxiYWNrKGVyciwgc3RyZWFtKWAgX2Z1bmN0aW9uXzogY2FsbGJhY2sgaXMgY2FsbGVkIHdpdGggYGVycmAgaW4gY2FzZSBvZiBlcnJvci4gYHN0cmVhbWAgaXMgdGhlIG9iamVjdCBjb250ZW50IHN0cmVhbVxuICBnZXRPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZ2V0T3B0cyA9IHt9LCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIC8vIEJhY2t3YXJkIENvbXBhdGliaWxpdHlcbiAgICBpZiAoaXNGdW5jdGlvbihnZXRPcHRzKSkge1xuICAgICAgY2IgPSBnZXRPcHRzXG4gICAgICBnZXRPcHRzID0ge31cbiAgICB9XG5cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICB0aGlzLmdldFBhcnRpYWxPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgMCwgMCwgZ2V0T3B0cywgY2IpXG4gIH1cblxuICAvLyBDYWxsYmFjayBpcyBjYWxsZWQgd2l0aCByZWFkYWJsZSBzdHJlYW0gb2YgdGhlIHBhcnRpYWwgb2JqZWN0IGNvbnRlbnQuXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBvYmplY3ROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0XG4gIC8vICogYG9mZnNldGAgX251bWJlcl86IG9mZnNldCBvZiB0aGUgb2JqZWN0IGZyb20gd2hlcmUgdGhlIHN0cmVhbSB3aWxsIHN0YXJ0XG4gIC8vICogYGxlbmd0aGAgX251bWJlcl86IGxlbmd0aCBvZiB0aGUgb2JqZWN0IHRoYXQgd2lsbCBiZSByZWFkIGluIHRoZSBzdHJlYW0gKG9wdGlvbmFsLCBpZiBub3Qgc3BlY2lmaWVkIHdlIHJlYWQgdGhlIHJlc3Qgb2YgdGhlIGZpbGUgZnJvbSB0aGUgb2Zmc2V0KVxuICAvLyAqIGBnZXRPcHRzYCBfb2JqZWN0XzogVmVyc2lvbiBvZiB0aGUgb2JqZWN0IGluIHRoZSBmb3JtIGB7dmVyc2lvbklkOidteS11dWlkJ31gLiBEZWZhdWx0IGlzIGB7fWAuIChvcHRpb25hbClcbiAgLy8gKiBgY2FsbGJhY2soZXJyLCBzdHJlYW0pYCBfZnVuY3Rpb25fOiBjYWxsYmFjayBpcyBjYWxsZWQgd2l0aCBgZXJyYCBpbiBjYXNlIG9mIGVycm9yLiBgc3RyZWFtYCBpcyB0aGUgb2JqZWN0IGNvbnRlbnQgc3RyZWFtXG4gIGdldFBhcnRpYWxPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgb2Zmc2V0LCBsZW5ndGgsIGdldE9wdHMgPSB7fSwgY2IpIHtcbiAgICBpZiAoaXNGdW5jdGlvbihsZW5ndGgpKSB7XG4gICAgICBjYiA9IGxlbmd0aFxuICAgICAgbGVuZ3RoID0gMFxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzTnVtYmVyKG9mZnNldCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29mZnNldCBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG4gICAgaWYgKCFpc051bWJlcihsZW5ndGgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsZW5ndGggc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuICAgIC8vIEJhY2t3YXJkIENvbXBhdGliaWxpdHlcbiAgICBpZiAoaXNGdW5jdGlvbihnZXRPcHRzKSkge1xuICAgICAgY2IgPSBnZXRPcHRzXG4gICAgICBnZXRPcHRzID0ge31cbiAgICB9XG5cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cblxuICAgIHZhciByYW5nZSA9ICcnXG4gICAgaWYgKG9mZnNldCB8fCBsZW5ndGgpIHtcbiAgICAgIGlmIChvZmZzZXQpIHtcbiAgICAgICAgcmFuZ2UgPSBgYnl0ZXM9JHsrb2Zmc2V0fS1gXG4gICAgICB9IGVsc2Uge1xuICAgICAgICByYW5nZSA9ICdieXRlcz0wLSdcbiAgICAgICAgb2Zmc2V0ID0gMFxuICAgICAgfVxuICAgICAgaWYgKGxlbmd0aCkge1xuICAgICAgICByYW5nZSArPSBgJHsrbGVuZ3RoICsgb2Zmc2V0IC0gMX1gXG4gICAgICB9XG4gICAgfVxuXG4gICAgdmFyIGhlYWRlcnMgPSB7fVxuICAgIGlmIChyYW5nZSAhPT0gJycpIHtcbiAgICAgIGhlYWRlcnMucmFuZ2UgPSByYW5nZVxuICAgIH1cblxuICAgIHZhciBleHBlY3RlZFN0YXR1c0NvZGVzID0gWzIwMF1cbiAgICBpZiAocmFuZ2UpIHtcbiAgICAgIGV4cGVjdGVkU3RhdHVzQ29kZXMucHVzaCgyMDYpXG4gICAgfVxuICAgIHZhciBtZXRob2QgPSAnR0VUJ1xuXG4gICAgdmFyIHF1ZXJ5ID0gcXVlcnlzdHJpbmcuc3RyaW5naWZ5KGdldE9wdHMpXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycywgcXVlcnkgfSwgJycsIGV4cGVjdGVkU3RhdHVzQ29kZXMsICcnLCB0cnVlLCBjYilcbiAgfVxuXG4gIC8vIFVwbG9hZHMgdGhlIG9iamVjdCB1c2luZyBjb250ZW50cyBmcm9tIGEgZmlsZVxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgb2JqZWN0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBmaWxlUGF0aGAgX3N0cmluZ186IGZpbGUgcGF0aCBvZiB0aGUgZmlsZSB0byBiZSB1cGxvYWRlZFxuICAvLyAqIGBtZXRhRGF0YWAgX0phdmFzY3JpcHQgT2JqZWN0XzogbWV0YURhdGEgYXNzb3NjaWF0ZWQgd2l0aCB0aGUgb2JqZWN0XG4gIC8vICogYGNhbGxiYWNrKGVyciwgb2JqSW5mbylgIF9mdW5jdGlvbl86IG5vbiBudWxsIGBlcnJgIGluZGljYXRlcyBlcnJvciwgYG9iakluZm9gIF9vYmplY3RfIHdoaWNoIGNvbnRhaW5zIHZlcnNpb25JZCBhbmQgZXRhZy5cbiAgZlB1dE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBmaWxlUGF0aCwgbWV0YURhdGEsIGNhbGxiYWNrKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIWlzU3RyaW5nKGZpbGVQYXRoKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZmlsZVBhdGggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmIChpc0Z1bmN0aW9uKG1ldGFEYXRhKSkge1xuICAgICAgY2FsbGJhY2sgPSBtZXRhRGF0YVxuICAgICAgbWV0YURhdGEgPSB7fSAvLyBTZXQgbWV0YURhdGEgZW1wdHkgaWYgbm8gbWV0YURhdGEgcHJvdmlkZWQuXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QobWV0YURhdGEpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtZXRhRGF0YSBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICAvLyBJbnNlcnRzIGNvcnJlY3QgYGNvbnRlbnQtdHlwZWAgYXR0cmlidXRlIGJhc2VkIG9uIG1ldGFEYXRhIGFuZCBmaWxlUGF0aFxuICAgIG1ldGFEYXRhID0gaW5zZXJ0Q29udGVudFR5cGUobWV0YURhdGEsIGZpbGVQYXRoKVxuXG4gICAgZnMubHN0YXQoZmlsZVBhdGgsIChlcnIsIHN0YXQpID0+IHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycilcbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzLnB1dE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBmcy5jcmVhdGVSZWFkU3RyZWFtKGZpbGVQYXRoKSwgc3RhdC5zaXplLCBtZXRhRGF0YSwgY2FsbGJhY2spXG4gICAgfSlcbiAgfVxuXG4gIC8vIFVwbG9hZHMgdGhlIG9iamVjdC5cbiAgLy9cbiAgLy8gVXBsb2FkaW5nIGEgc3RyZWFtXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBvYmplY3ROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0XG4gIC8vICogYHN0cmVhbWAgX1N0cmVhbV86IFJlYWRhYmxlIHN0cmVhbVxuICAvLyAqIGBzaXplYCBfbnVtYmVyXzogc2l6ZSBvZiB0aGUgb2JqZWN0IChvcHRpb25hbClcbiAgLy8gKiBgY2FsbGJhY2soZXJyLCBldGFnKWAgX2Z1bmN0aW9uXzogbm9uIG51bGwgYGVycmAgaW5kaWNhdGVzIGVycm9yLCBgZXRhZ2AgX3N0cmluZ18gaXMgdGhlIGV0YWcgb2YgdGhlIG9iamVjdCB1cGxvYWRlZC5cbiAgLy9cbiAgLy8gVXBsb2FkaW5nIFwiQnVmZmVyXCIgb3IgXCJzdHJpbmdcIlxuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgb2JqZWN0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBzdHJpbmcgb3IgQnVmZmVyYCBfc3RyaW5nXyBvciBfQnVmZmVyXzogc3RyaW5nIG9yIGJ1ZmZlclxuICAvLyAqIGBjYWxsYmFjayhlcnIsIG9iakluZm8pYCBfZnVuY3Rpb25fOiBgZXJyYCBpcyBgbnVsbGAgaW4gY2FzZSBvZiBzdWNjZXNzIGFuZCBgaW5mb2Agd2lsbCBoYXZlIHRoZSBmb2xsb3dpbmcgb2JqZWN0IGRldGFpbHM6XG4gIC8vICAgKiBgZXRhZ2AgX3N0cmluZ186IGV0YWcgb2YgdGhlIG9iamVjdFxuICAvLyAgICogYHZlcnNpb25JZGAgX3N0cmluZ186IHZlcnNpb25JZCBvZiB0aGUgb2JqZWN0XG4gIHB1dE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBzdHJlYW0sIHNpemUsIG1ldGFEYXRhLCBjYWxsYmFjaykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgLy8gV2UnbGwgbmVlZCB0byBzaGlmdCBhcmd1bWVudHMgdG8gdGhlIGxlZnQgYmVjYXVzZSBvZiBzaXplIGFuZCBtZXRhRGF0YS5cbiAgICBpZiAoaXNGdW5jdGlvbihzaXplKSkge1xuICAgICAgY2FsbGJhY2sgPSBzaXplXG4gICAgICBtZXRhRGF0YSA9IHt9XG4gICAgfSBlbHNlIGlmIChpc0Z1bmN0aW9uKG1ldGFEYXRhKSkge1xuICAgICAgY2FsbGJhY2sgPSBtZXRhRGF0YVxuICAgICAgbWV0YURhdGEgPSB7fVxuICAgIH1cblxuICAgIC8vIFdlJ2xsIG5lZWQgdG8gc2hpZnQgYXJndW1lbnRzIHRvIHRoZSBsZWZ0IGJlY2F1c2Ugb2YgbWV0YURhdGFcbiAgICAvLyBhbmQgc2l6ZSBiZWluZyBvcHRpb25hbC5cbiAgICBpZiAoaXNPYmplY3Qoc2l6ZSkpIHtcbiAgICAgIG1ldGFEYXRhID0gc2l6ZVxuICAgIH1cblxuICAgIC8vIEVuc3VyZXMgTWV0YWRhdGEgaGFzIGFwcHJvcHJpYXRlIHByZWZpeCBmb3IgQTMgQVBJXG4gICAgbWV0YURhdGEgPSBwcmVwZW5kWEFNWk1ldGEobWV0YURhdGEpXG4gICAgaWYgKHR5cGVvZiBzdHJlYW0gPT09ICdzdHJpbmcnIHx8IHN0cmVhbSBpbnN0YW5jZW9mIEJ1ZmZlcikge1xuICAgICAgLy8gQWRhcHRzIHRoZSBub24tc3RyZWFtIGludGVyZmFjZSBpbnRvIGEgc3RyZWFtLlxuICAgICAgc2l6ZSA9IHN0cmVhbS5sZW5ndGhcbiAgICAgIHN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKHN0cmVhbSlcbiAgICB9IGVsc2UgaWYgKCFpc1JlYWRhYmxlU3RyZWFtKHN0cmVhbSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3RoaXJkIGFyZ3VtZW50IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyZWFtLlJlYWRhYmxlXCIgb3IgXCJCdWZmZXJcIiBvciBcInN0cmluZ1wiJylcbiAgICB9XG5cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2FsbGJhY2spKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cblxuICAgIGlmIChpc051bWJlcihzaXplKSAmJiBzaXplIDwgMCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgc2l6ZSBjYW5ub3QgYmUgbmVnYXRpdmUsIGdpdmVuIHNpemU6ICR7c2l6ZX1gKVxuICAgIH1cblxuICAgIC8vIEdldCB0aGUgcGFydCBzaXplIGFuZCBmb3J3YXJkIHRoYXQgdG8gdGhlIEJsb2NrU3RyZWFtLiBEZWZhdWx0IHRvIHRoZVxuICAgIC8vIGxhcmdlc3QgYmxvY2sgc2l6ZSBwb3NzaWJsZSBpZiBuZWNlc3NhcnkuXG4gICAgaWYgKCFpc051bWJlcihzaXplKSkge1xuICAgICAgc2l6ZSA9IHRoaXMubWF4T2JqZWN0U2l6ZVxuICAgIH1cblxuICAgIHNpemUgPSB0aGlzLmNhbGN1bGF0ZVBhcnRTaXplKHNpemUpXG5cbiAgICAvLyBzMyByZXF1aXJlcyB0aGF0IGFsbCBub24tZW5kIGNodW5rcyBiZSBhdCBsZWFzdCBgdGhpcy5wYXJ0U2l6ZWAsXG4gICAgLy8gc28gd2UgY2h1bmsgdGhlIHN0cmVhbSB1bnRpbCB3ZSBoaXQgZWl0aGVyIHRoYXQgc2l6ZSBvciB0aGUgZW5kIGJlZm9yZVxuICAgIC8vIHdlIGZsdXNoIGl0IHRvIHMzLlxuICAgIGxldCBjaHVua2VyID0gbmV3IEJsb2NrU3RyZWFtMih7IHNpemUsIHplcm9QYWRkaW5nOiBmYWxzZSB9KVxuXG4gICAgLy8gVGhpcyBpcyBhIFdyaXRhYmxlIHN0cmVhbSB0aGF0IGNhbiBiZSB3cml0dGVuIHRvIGluIG9yZGVyIHRvIHVwbG9hZFxuICAgIC8vIHRvIHRoZSBzcGVjaWZpZWQgYnVja2V0IGFuZCBvYmplY3QgYXV0b21hdGljYWxseS5cbiAgICBsZXQgdXBsb2FkZXIgPSBuZXcgT2JqZWN0VXBsb2FkZXIodGhpcywgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgc2l6ZSwgbWV0YURhdGEsIGNhbGxiYWNrKVxuICAgIC8vIHN0cmVhbSA9PiBjaHVua2VyID0+IHVwbG9hZGVyXG4gICAgcGlwZXNldHVwKHN0cmVhbSwgY2h1bmtlciwgdXBsb2FkZXIpXG4gIH1cblxuICAvLyBDb3B5IHRoZSBvYmplY3QuXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBvYmplY3ROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0XG4gIC8vICogYHNyY09iamVjdGAgX3N0cmluZ186IHBhdGggb2YgdGhlIHNvdXJjZSBvYmplY3QgdG8gYmUgY29waWVkXG4gIC8vICogYGNvbmRpdGlvbnNgIF9Db3B5Q29uZGl0aW9uc186IGNvcHkgY29uZGl0aW9ucyB0aGF0IG5lZWRzIHRvIGJlIHNhdGlzZmllZCAob3B0aW9uYWwsIGRlZmF1bHQgYG51bGxgKVxuICAvLyAqIGBjYWxsYmFjayhlcnIsIHtldGFnLCBsYXN0TW9kaWZpZWR9KWAgX2Z1bmN0aW9uXzogbm9uIG51bGwgYGVycmAgaW5kaWNhdGVzIGVycm9yLCBgZXRhZ2AgX3N0cmluZ18gYW5kIGBsaXN0TW9kaWZlZGAgX0RhdGVfIGFyZSByZXNwZWN0aXZlbHkgdGhlIGV0YWcgYW5kIHRoZSBsYXN0IG1vZGlmaWVkIGRhdGUgb2YgdGhlIG5ld2x5IGNvcGllZCBvYmplY3RcbiAgY29weU9iamVjdFYxKGFyZzEsIGFyZzIsIGFyZzMsIGFyZzQsIGFyZzUpIHtcbiAgICB2YXIgYnVja2V0TmFtZSA9IGFyZzFcbiAgICB2YXIgb2JqZWN0TmFtZSA9IGFyZzJcbiAgICB2YXIgc3JjT2JqZWN0ID0gYXJnM1xuICAgIHZhciBjb25kaXRpb25zLCBjYlxuICAgIGlmICh0eXBlb2YgYXJnNCA9PSAnZnVuY3Rpb24nICYmIGFyZzUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uZGl0aW9ucyA9IG51bGxcbiAgICAgIGNiID0gYXJnNFxuICAgIH0gZWxzZSB7XG4gICAgICBjb25kaXRpb25zID0gYXJnNFxuICAgICAgY2IgPSBhcmc1XG4gICAgfVxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoc3JjT2JqZWN0KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc3JjT2JqZWN0IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoc3JjT2JqZWN0ID09PSAnJykge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkUHJlZml4RXJyb3IoYEVtcHR5IHNvdXJjZSBwcmVmaXhgKVxuICAgIH1cblxuICAgIGlmIChjb25kaXRpb25zICE9PSBudWxsICYmICEoY29uZGl0aW9ucyBpbnN0YW5jZW9mIENvcHlDb25kaXRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY29uZGl0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIkNvcHlDb25kaXRpb25zXCInKVxuICAgIH1cblxuICAgIHZhciBoZWFkZXJzID0ge31cbiAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZSddID0gdXJpUmVzb3VyY2VFc2NhcGUoc3JjT2JqZWN0KVxuXG4gICAgaWYgKGNvbmRpdGlvbnMgIT09IG51bGwpIHtcbiAgICAgIGlmIChjb25kaXRpb25zLm1vZGlmaWVkICE9PSAnJykge1xuICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1pZi1tb2RpZmllZC1zaW5jZSddID0gY29uZGl0aW9ucy5tb2RpZmllZFxuICAgICAgfVxuICAgICAgaWYgKGNvbmRpdGlvbnMudW5tb2RpZmllZCAhPT0gJycpIHtcbiAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtaWYtdW5tb2RpZmllZC1zaW5jZSddID0gY29uZGl0aW9ucy51bm1vZGlmaWVkXG4gICAgICB9XG4gICAgICBpZiAoY29uZGl0aW9ucy5tYXRjaEVUYWcgIT09ICcnKSB7XG4gICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLWlmLW1hdGNoJ10gPSBjb25kaXRpb25zLm1hdGNoRVRhZ1xuICAgICAgfVxuICAgICAgaWYgKGNvbmRpdGlvbnMubWF0Y2hFdGFnRXhjZXB0ICE9PSAnJykge1xuICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1pZi1ub25lLW1hdGNoJ10gPSBjb25kaXRpb25zLm1hdGNoRVRhZ0V4Y2VwdFxuICAgICAgfVxuICAgIH1cblxuICAgIHZhciBtZXRob2QgPSAnUFVUJ1xuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMgfSwgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gY2IoZSlcbiAgICAgIH1cbiAgICAgIHZhciB0cmFuc2Zvcm1lciA9IHRyYW5zZm9ybWVycy5nZXRDb3B5T2JqZWN0VHJhbnNmb3JtZXIoKVxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcilcbiAgICAgICAgLm9uKCdlcnJvcicsIChlKSA9PiBjYihlKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKGRhdGEpID0+IGNiKG51bGwsIGRhdGEpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogSW50ZXJuYWwgTWV0aG9kIHRvIHBlcmZvcm0gY29weSBvZiBhbiBvYmplY3QuXG4gICAqIEBwYXJhbSBzb3VyY2VDb25maWcgX19vYmplY3RfXyAgIGluc3RhbmNlIG9mIENvcHlTb3VyY2VPcHRpb25zIEBsaW5rIC4vaGVscGVycy9Db3B5U291cmNlT3B0aW9uc1xuICAgKiBAcGFyYW0gZGVzdENvbmZpZyAgX19vYmplY3RfXyAgIGluc3RhbmNlIG9mIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMgQGxpbmsgLi9oZWxwZXJzL0NvcHlEZXN0aW5hdGlvbk9wdGlvbnNcbiAgICogQHBhcmFtIGNiIF9fZnVuY3Rpb25fXyBjYWxsZWQgd2l0aCBudWxsIGlmIHRoZXJlIGlzIGFuIGVycm9yXG4gICAqIEByZXR1cm5zIFByb21pc2UgaWYgbm8gY2FsbGFjayBpcyBwYXNzZWQuXG4gICAqL1xuICBjb3B5T2JqZWN0VjIoc291cmNlQ29uZmlnLCBkZXN0Q29uZmlnLCBjYikge1xuICAgIGlmICghKHNvdXJjZUNvbmZpZyBpbnN0YW5jZW9mIENvcHlTb3VyY2VPcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignc291cmNlQ29uZmlnIHNob3VsZCBvZiB0eXBlIENvcHlTb3VyY2VPcHRpb25zICcpXG4gICAgfVxuICAgIGlmICghKGRlc3RDb25maWcgaW5zdGFuY2VvZiBDb3B5RGVzdGluYXRpb25PcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignZGVzdENvbmZpZyBzaG91bGQgb2YgdHlwZSBDb3B5RGVzdGluYXRpb25PcHRpb25zICcpXG4gICAgfVxuICAgIGlmICghZGVzdENvbmZpZy52YWxpZGF0ZSgpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gICAgaWYgKCFkZXN0Q29uZmlnLnZhbGlkYXRlKCkpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cblxuICAgIGNvbnN0IGhlYWRlcnMgPSBPYmplY3QuYXNzaWduKHt9LCBzb3VyY2VDb25maWcuZ2V0SGVhZGVycygpLCBkZXN0Q29uZmlnLmdldEhlYWRlcnMoKSlcblxuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBkZXN0Q29uZmlnLkJ1Y2tldFxuICAgIGNvbnN0IG9iamVjdE5hbWUgPSBkZXN0Q29uZmlnLk9iamVjdFxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzIH0sICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG4gICAgICBjb25zdCB0cmFuc2Zvcm1lciA9IHRyYW5zZm9ybWVycy5nZXRDb3B5T2JqZWN0VHJhbnNmb3JtZXIoKVxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcilcbiAgICAgICAgLm9uKCdlcnJvcicsIChlKSA9PiBjYihlKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICAgICAgICBjb25zdCByZXNIZWFkZXJzID0gcmVzcG9uc2UuaGVhZGVyc1xuXG4gICAgICAgICAgY29uc3QgY29weU9ialJlc3BvbnNlID0ge1xuICAgICAgICAgICAgQnVja2V0OiBkZXN0Q29uZmlnLkJ1Y2tldCxcbiAgICAgICAgICAgIEtleTogZGVzdENvbmZpZy5PYmplY3QsXG4gICAgICAgICAgICBMYXN0TW9kaWZpZWQ6IGRhdGEuTGFzdE1vZGlmaWVkLFxuICAgICAgICAgICAgTWV0YURhdGE6IGV4dHJhY3RNZXRhZGF0YShyZXNIZWFkZXJzKSxcbiAgICAgICAgICAgIFZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlc0hlYWRlcnMpLFxuICAgICAgICAgICAgU291cmNlVmVyc2lvbklkOiBnZXRTb3VyY2VWZXJzaW9uSWQocmVzSGVhZGVycyksXG4gICAgICAgICAgICBFdGFnOiBzYW5pdGl6ZUVUYWcocmVzSGVhZGVycy5ldGFnKSxcbiAgICAgICAgICAgIFNpemU6ICtyZXNIZWFkZXJzWydjb250ZW50LWxlbmd0aCddLFxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiBjYihudWxsLCBjb3B5T2JqUmVzcG9uc2UpXG4gICAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8vIEJhY2t3YXJkIGNvbXBhdGliaWxpdHkgZm9yIENvcHkgT2JqZWN0IEFQSS5cbiAgY29weU9iamVjdCguLi5hbGxBcmdzKSB7XG4gICAgaWYgKGFsbEFyZ3NbMF0gaW5zdGFuY2VvZiBDb3B5U291cmNlT3B0aW9ucyAmJiBhbGxBcmdzWzFdIGluc3RhbmNlb2YgQ29weURlc3RpbmF0aW9uT3B0aW9ucykge1xuICAgICAgcmV0dXJuIHRoaXMuY29weU9iamVjdFYyKC4uLmFyZ3VtZW50cylcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuY29weU9iamVjdFYxKC4uLmFyZ3VtZW50cylcbiAgfVxuXG4gIC8vIGxpc3QgYSBiYXRjaCBvZiBvYmplY3RzXG4gIGxpc3RPYmplY3RzUXVlcnkoYnVja2V0TmFtZSwgcHJlZml4LCBtYXJrZXIsIGxpc3RRdWVyeU9wdHMgPSB7fSkge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKG1hcmtlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21hcmtlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgbGV0IHsgRGVsaW1pdGVyLCBNYXhLZXlzLCBJbmNsdWRlVmVyc2lvbiB9ID0gbGlzdFF1ZXJ5T3B0c1xuXG4gICAgaWYgKCFpc09iamVjdChsaXN0UXVlcnlPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdFF1ZXJ5T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBpZiAoIWlzU3RyaW5nKERlbGltaXRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0RlbGltaXRlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc051bWJlcihNYXhLZXlzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignTWF4S2V5cyBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG5cbiAgICBjb25zdCBxdWVyaWVzID0gW11cbiAgICAvLyBlc2NhcGUgZXZlcnkgdmFsdWUgaW4gcXVlcnkgc3RyaW5nLCBleGNlcHQgbWF4S2V5c1xuICAgIHF1ZXJpZXMucHVzaChgcHJlZml4PSR7dXJpRXNjYXBlKHByZWZpeCl9YClcbiAgICBxdWVyaWVzLnB1c2goYGRlbGltaXRlcj0ke3VyaUVzY2FwZShEZWxpbWl0ZXIpfWApXG4gICAgcXVlcmllcy5wdXNoKGBlbmNvZGluZy10eXBlPXVybGApXG5cbiAgICBpZiAoSW5jbHVkZVZlcnNpb24pIHtcbiAgICAgIHF1ZXJpZXMucHVzaChgdmVyc2lvbnNgKVxuICAgIH1cblxuICAgIGlmIChtYXJrZXIpIHtcbiAgICAgIG1hcmtlciA9IHVyaUVzY2FwZShtYXJrZXIpXG4gICAgICBpZiAoSW5jbHVkZVZlcnNpb24pIHtcbiAgICAgICAgcXVlcmllcy5wdXNoKGBrZXktbWFya2VyPSR7bWFya2VyfWApXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBxdWVyaWVzLnB1c2goYG1hcmtlcj0ke21hcmtlcn1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIG5vIG5lZWQgdG8gZXNjYXBlIG1heEtleXNcbiAgICBpZiAoTWF4S2V5cykge1xuICAgICAgaWYgKE1heEtleXMgPj0gMTAwMCkge1xuICAgICAgICBNYXhLZXlzID0gMTAwMFxuICAgICAgfVxuICAgICAgcXVlcmllcy5wdXNoKGBtYXgta2V5cz0ke01heEtleXN9YClcbiAgICB9XG4gICAgcXVlcmllcy5zb3J0KClcbiAgICB2YXIgcXVlcnkgPSAnJ1xuICAgIGlmIChxdWVyaWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcmllcy5qb2luKCcmJyl9YFxuICAgIH1cblxuICAgIHZhciBtZXRob2QgPSAnR0VUJ1xuICAgIHZhciB0cmFuc2Zvcm1lciA9IHRyYW5zZm9ybWVycy5nZXRMaXN0T2JqZWN0c1RyYW5zZm9ybWVyKClcbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiB0cmFuc2Zvcm1lci5lbWl0KCdlcnJvcicsIGUpXG4gICAgICB9XG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVyKVxuICAgIH0pXG4gICAgcmV0dXJuIHRyYW5zZm9ybWVyXG4gIH1cblxuICAvLyBMaXN0IHRoZSBvYmplY3RzIGluIHRoZSBidWNrZXQuXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBwcmVmaXhgIF9zdHJpbmdfOiB0aGUgcHJlZml4IG9mIHRoZSBvYmplY3RzIHRoYXQgc2hvdWxkIGJlIGxpc3RlZCAob3B0aW9uYWwsIGRlZmF1bHQgYCcnYClcbiAgLy8gKiBgcmVjdXJzaXZlYCBfYm9vbF86IGB0cnVlYCBpbmRpY2F0ZXMgcmVjdXJzaXZlIHN0eWxlIGxpc3RpbmcgYW5kIGBmYWxzZWAgaW5kaWNhdGVzIGRpcmVjdG9yeSBzdHlsZSBsaXN0aW5nIGRlbGltaXRlZCBieSAnLycuIChvcHRpb25hbCwgZGVmYXVsdCBgZmFsc2VgKVxuICAvLyAqIGBsaXN0T3B0cyBfb2JqZWN0XzogcXVlcnkgcGFyYW1zIHRvIGxpc3Qgb2JqZWN0IHdpdGggYmVsb3cga2V5c1xuICAvLyAqICAgIGxpc3RPcHRzLk1heEtleXMgX2ludF8gbWF4aW11bSBudW1iZXIgb2Yga2V5cyB0byByZXR1cm5cbiAgLy8gKiAgICBsaXN0T3B0cy5JbmNsdWRlVmVyc2lvbiAgX2Jvb2xfIHRydWV8ZmFsc2UgdG8gaW5jbHVkZSB2ZXJzaW9ucy5cbiAgLy8gX19SZXR1cm4gVmFsdWVfX1xuICAvLyAqIGBzdHJlYW1gIF9TdHJlYW1fOiBzdHJlYW0gZW1pdHRpbmcgdGhlIG9iamVjdHMgaW4gdGhlIGJ1Y2tldCwgdGhlIG9iamVjdCBpcyBvZiB0aGUgZm9ybWF0OlxuICAvLyAqIGBvYmoubmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBvYmoucHJlZml4YCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0IHByZWZpeFxuICAvLyAqIGBvYmouc2l6ZWAgX251bWJlcl86IHNpemUgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBvYmouZXRhZ2AgX3N0cmluZ186IGV0YWcgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBvYmoubGFzdE1vZGlmaWVkYCBfRGF0ZV86IG1vZGlmaWVkIHRpbWUgc3RhbXBcbiAgLy8gKiBgb2JqLmlzRGVsZXRlTWFya2VyYCBfYm9vbGVhbl86IHRydWUgaWYgaXQgaXMgYSBkZWxldGUgbWFya2VyXG4gIC8vICogYG9iai52ZXJzaW9uSWRgIF9zdHJpbmdfOiB2ZXJzaW9uSWQgb2YgdGhlIG9iamVjdFxuICBsaXN0T2JqZWN0cyhidWNrZXROYW1lLCBwcmVmaXgsIHJlY3Vyc2l2ZSwgbGlzdE9wdHMgPSB7fSkge1xuICAgIGlmIChwcmVmaXggPT09IHVuZGVmaW5lZCkge1xuICAgICAgcHJlZml4ID0gJydcbiAgICB9XG4gICAgaWYgKHJlY3Vyc2l2ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZWN1cnNpdmUgPSBmYWxzZVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRQcmVmaXgocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkUHJlZml4RXJyb3IoYEludmFsaWQgcHJlZml4IDogJHtwcmVmaXh9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNCb29sZWFuKHJlY3Vyc2l2ZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlY3Vyc2l2ZSBzaG91bGQgYmUgb2YgdHlwZSBcImJvb2xlYW5cIicpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QobGlzdE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgdmFyIG1hcmtlciA9ICcnXG4gICAgY29uc3QgbGlzdFF1ZXJ5T3B0cyA9IHtcbiAgICAgIERlbGltaXRlcjogcmVjdXJzaXZlID8gJycgOiAnLycsIC8vIGlmIHJlY3Vyc2l2ZSBpcyBmYWxzZSBzZXQgZGVsaW1pdGVyIHRvICcvJ1xuICAgICAgTWF4S2V5czogMTAwMCxcbiAgICAgIEluY2x1ZGVWZXJzaW9uOiBsaXN0T3B0cy5JbmNsdWRlVmVyc2lvbixcbiAgICB9XG4gICAgdmFyIG9iamVjdHMgPSBbXVxuICAgIHZhciBlbmRlZCA9IGZhbHNlXG4gICAgdmFyIHJlYWRTdHJlYW0gPSBTdHJlYW0uUmVhZGFibGUoeyBvYmplY3RNb2RlOiB0cnVlIH0pXG4gICAgcmVhZFN0cmVhbS5fcmVhZCA9ICgpID0+IHtcbiAgICAgIC8vIHB1c2ggb25lIG9iamVjdCBwZXIgX3JlYWQoKVxuICAgICAgaWYgKG9iamVjdHMubGVuZ3RoKSB7XG4gICAgICAgIHJlYWRTdHJlYW0ucHVzaChvYmplY3RzLnNoaWZ0KCkpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgICAgaWYgKGVuZGVkKSB7XG4gICAgICAgIHJldHVybiByZWFkU3RyZWFtLnB1c2gobnVsbClcbiAgICAgIH1cbiAgICAgIC8vIGlmIHRoZXJlIGFyZSBubyBvYmplY3RzIHRvIHB1c2ggZG8gcXVlcnkgZm9yIHRoZSBuZXh0IGJhdGNoIG9mIG9iamVjdHNcbiAgICAgIHRoaXMubGlzdE9iamVjdHNRdWVyeShidWNrZXROYW1lLCBwcmVmaXgsIG1hcmtlciwgbGlzdFF1ZXJ5T3B0cylcbiAgICAgICAgLm9uKCdlcnJvcicsIChlKSA9PiByZWFkU3RyZWFtLmVtaXQoJ2Vycm9yJywgZSkpXG4gICAgICAgIC5vbignZGF0YScsIChyZXN1bHQpID0+IHtcbiAgICAgICAgICBpZiAocmVzdWx0LmlzVHJ1bmNhdGVkKSB7XG4gICAgICAgICAgICBtYXJrZXIgPSByZXN1bHQubmV4dE1hcmtlciB8fCByZXN1bHQudmVyc2lvbklkTWFya2VyXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGVuZGVkID0gdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgICBvYmplY3RzID0gcmVzdWx0Lm9iamVjdHNcbiAgICAgICAgICByZWFkU3RyZWFtLl9yZWFkKClcbiAgICAgICAgfSlcbiAgICB9XG4gICAgcmV0dXJuIHJlYWRTdHJlYW1cbiAgfVxuXG4gIC8vIGxpc3RPYmplY3RzVjJRdWVyeSAtIChMaXN0IE9iamVjdHMgVjIpIC0gTGlzdCBzb21lIG9yIGFsbCAodXAgdG8gMTAwMCkgb2YgdGhlIG9iamVjdHMgaW4gYSBidWNrZXQuXG4gIC8vXG4gIC8vIFlvdSBjYW4gdXNlIHRoZSByZXF1ZXN0IHBhcmFtZXRlcnMgYXMgc2VsZWN0aW9uIGNyaXRlcmlhIHRvIHJldHVybiBhIHN1YnNldCBvZiB0aGUgb2JqZWN0cyBpbiBhIGJ1Y2tldC5cbiAgLy8gcmVxdWVzdCBwYXJhbWV0ZXJzIDotXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgcHJlZml4YCBfc3RyaW5nXzogTGltaXRzIHRoZSByZXNwb25zZSB0byBrZXlzIHRoYXQgYmVnaW4gd2l0aCB0aGUgc3BlY2lmaWVkIHByZWZpeC5cbiAgLy8gKiBgY29udGludWF0aW9uLXRva2VuYCBfc3RyaW5nXzogVXNlZCB0byBjb250aW51ZSBpdGVyYXRpbmcgb3ZlciBhIHNldCBvZiBvYmplY3RzLlxuICAvLyAqIGBkZWxpbWl0ZXJgIF9zdHJpbmdfOiBBIGRlbGltaXRlciBpcyBhIGNoYXJhY3RlciB5b3UgdXNlIHRvIGdyb3VwIGtleXMuXG4gIC8vICogYG1heC1rZXlzYCBfbnVtYmVyXzogU2V0cyB0aGUgbWF4aW11bSBudW1iZXIgb2Yga2V5cyByZXR1cm5lZCBpbiB0aGUgcmVzcG9uc2UgYm9keS5cbiAgLy8gKiBgc3RhcnQtYWZ0ZXJgIF9zdHJpbmdfOiBTcGVjaWZpZXMgdGhlIGtleSB0byBzdGFydCBhZnRlciB3aGVuIGxpc3Rpbmcgb2JqZWN0cyBpbiBhIGJ1Y2tldC5cbiAgbGlzdE9iamVjdHNWMlF1ZXJ5KGJ1Y2tldE5hbWUsIHByZWZpeCwgY29udGludWF0aW9uVG9rZW4sIGRlbGltaXRlciwgbWF4S2V5cywgc3RhcnRBZnRlcikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGNvbnRpbnVhdGlvblRva2VuKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY29udGludWF0aW9uVG9rZW4gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoZGVsaW1pdGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZGVsaW1pdGVyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzTnVtYmVyKG1heEtleXMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtYXhLZXlzIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHN0YXJ0QWZ0ZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdGFydEFmdGVyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICB2YXIgcXVlcmllcyA9IFtdXG5cbiAgICAvLyBDYWxsIGZvciBsaXN0aW5nIG9iamVjdHMgdjIgQVBJXG4gICAgcXVlcmllcy5wdXNoKGBsaXN0LXR5cGU9MmApXG4gICAgcXVlcmllcy5wdXNoKGBlbmNvZGluZy10eXBlPXVybGApXG5cbiAgICAvLyBlc2NhcGUgZXZlcnkgdmFsdWUgaW4gcXVlcnkgc3RyaW5nLCBleGNlcHQgbWF4S2V5c1xuICAgIHF1ZXJpZXMucHVzaChgcHJlZml4PSR7dXJpRXNjYXBlKHByZWZpeCl9YClcbiAgICBxdWVyaWVzLnB1c2goYGRlbGltaXRlcj0ke3VyaUVzY2FwZShkZWxpbWl0ZXIpfWApXG5cbiAgICBpZiAoY29udGludWF0aW9uVG9rZW4pIHtcbiAgICAgIGNvbnRpbnVhdGlvblRva2VuID0gdXJpRXNjYXBlKGNvbnRpbnVhdGlvblRva2VuKVxuICAgICAgcXVlcmllcy5wdXNoKGBjb250aW51YXRpb24tdG9rZW49JHtjb250aW51YXRpb25Ub2tlbn1gKVxuICAgIH1cbiAgICAvLyBTZXQgc3RhcnQtYWZ0ZXJcbiAgICBpZiAoc3RhcnRBZnRlcikge1xuICAgICAgc3RhcnRBZnRlciA9IHVyaUVzY2FwZShzdGFydEFmdGVyKVxuICAgICAgcXVlcmllcy5wdXNoKGBzdGFydC1hZnRlcj0ke3N0YXJ0QWZ0ZXJ9YClcbiAgICB9XG4gICAgLy8gbm8gbmVlZCB0byBlc2NhcGUgbWF4S2V5c1xuICAgIGlmIChtYXhLZXlzKSB7XG4gICAgICBpZiAobWF4S2V5cyA+PSAxMDAwKSB7XG4gICAgICAgIG1heEtleXMgPSAxMDAwXG4gICAgICB9XG4gICAgICBxdWVyaWVzLnB1c2goYG1heC1rZXlzPSR7bWF4S2V5c31gKVxuICAgIH1cbiAgICBxdWVyaWVzLnNvcnQoKVxuICAgIHZhciBxdWVyeSA9ICcnXG4gICAgaWYgKHF1ZXJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyaWVzLmpvaW4oJyYnKX1gXG4gICAgfVxuICAgIHZhciBtZXRob2QgPSAnR0VUJ1xuICAgIHZhciB0cmFuc2Zvcm1lciA9IHRyYW5zZm9ybWVycy5nZXRMaXN0T2JqZWN0c1YyVHJhbnNmb3JtZXIoKVxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIHRyYW5zZm9ybWVyLmVtaXQoJ2Vycm9yJywgZSlcbiAgICAgIH1cbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXIpXG4gICAgfSlcbiAgICByZXR1cm4gdHJhbnNmb3JtZXJcbiAgfVxuXG4gIC8vIExpc3QgdGhlIG9iamVjdHMgaW4gdGhlIGJ1Y2tldCB1c2luZyBTMyBMaXN0T2JqZWN0cyBWMlxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgcHJlZml4YCBfc3RyaW5nXzogdGhlIHByZWZpeCBvZiB0aGUgb2JqZWN0cyB0aGF0IHNob3VsZCBiZSBsaXN0ZWQgKG9wdGlvbmFsLCBkZWZhdWx0IGAnJ2ApXG4gIC8vICogYHJlY3Vyc2l2ZWAgX2Jvb2xfOiBgdHJ1ZWAgaW5kaWNhdGVzIHJlY3Vyc2l2ZSBzdHlsZSBsaXN0aW5nIGFuZCBgZmFsc2VgIGluZGljYXRlcyBkaXJlY3Rvcnkgc3R5bGUgbGlzdGluZyBkZWxpbWl0ZWQgYnkgJy8nLiAob3B0aW9uYWwsIGRlZmF1bHQgYGZhbHNlYClcbiAgLy8gKiBgc3RhcnRBZnRlcmAgX3N0cmluZ186IFNwZWNpZmllcyB0aGUga2V5IHRvIHN0YXJ0IGFmdGVyIHdoZW4gbGlzdGluZyBvYmplY3RzIGluIGEgYnVja2V0LiAob3B0aW9uYWwsIGRlZmF1bHQgYCcnYClcbiAgLy9cbiAgLy8gX19SZXR1cm4gVmFsdWVfX1xuICAvLyAqIGBzdHJlYW1gIF9TdHJlYW1fOiBzdHJlYW0gZW1pdHRpbmcgdGhlIG9iamVjdHMgaW4gdGhlIGJ1Y2tldCwgdGhlIG9iamVjdCBpcyBvZiB0aGUgZm9ybWF0OlxuICAvLyAgICogYG9iai5uYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0XG4gIC8vICAgKiBgb2JqLnByZWZpeGAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdCBwcmVmaXhcbiAgLy8gICAqIGBvYmouc2l6ZWAgX251bWJlcl86IHNpemUgb2YgdGhlIG9iamVjdFxuICAvLyAgICogYG9iai5ldGFnYCBfc3RyaW5nXzogZXRhZyBvZiB0aGUgb2JqZWN0XG4gIC8vICAgKiBgb2JqLmxhc3RNb2RpZmllZGAgX0RhdGVfOiBtb2RpZmllZCB0aW1lIHN0YW1wXG4gIGxpc3RPYmplY3RzVjIoYnVja2V0TmFtZSwgcHJlZml4LCByZWN1cnNpdmUsIHN0YXJ0QWZ0ZXIpIHtcbiAgICBpZiAocHJlZml4ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHByZWZpeCA9ICcnXG4gICAgfVxuICAgIGlmIChyZWN1cnNpdmUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmVjdXJzaXZlID0gZmFsc2VcbiAgICB9XG4gICAgaWYgKHN0YXJ0QWZ0ZXIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgc3RhcnRBZnRlciA9ICcnXG4gICAgfVxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZFByZWZpeChwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRQcmVmaXhFcnJvcihgSW52YWxpZCBwcmVmaXggOiAke3ByZWZpeH1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc0Jvb2xlYW4ocmVjdXJzaXZlKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVjdXJzaXZlIHNob3VsZCBiZSBvZiB0eXBlIFwiYm9vbGVhblwiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhzdGFydEFmdGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc3RhcnRBZnRlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgLy8gaWYgcmVjdXJzaXZlIGlzIGZhbHNlIHNldCBkZWxpbWl0ZXIgdG8gJy8nXG4gICAgdmFyIGRlbGltaXRlciA9IHJlY3Vyc2l2ZSA/ICcnIDogJy8nXG4gICAgdmFyIGNvbnRpbnVhdGlvblRva2VuID0gJydcbiAgICB2YXIgb2JqZWN0cyA9IFtdXG4gICAgdmFyIGVuZGVkID0gZmFsc2VcbiAgICB2YXIgcmVhZFN0cmVhbSA9IFN0cmVhbS5SZWFkYWJsZSh7IG9iamVjdE1vZGU6IHRydWUgfSlcbiAgICByZWFkU3RyZWFtLl9yZWFkID0gKCkgPT4ge1xuICAgICAgLy8gcHVzaCBvbmUgb2JqZWN0IHBlciBfcmVhZCgpXG4gICAgICBpZiAob2JqZWN0cy5sZW5ndGgpIHtcbiAgICAgICAgcmVhZFN0cmVhbS5wdXNoKG9iamVjdHMuc2hpZnQoKSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG4gICAgICBpZiAoZW5kZWQpIHtcbiAgICAgICAgcmV0dXJuIHJlYWRTdHJlYW0ucHVzaChudWxsKVxuICAgICAgfVxuICAgICAgLy8gaWYgdGhlcmUgYXJlIG5vIG9iamVjdHMgdG8gcHVzaCBkbyBxdWVyeSBmb3IgdGhlIG5leHQgYmF0Y2ggb2Ygb2JqZWN0c1xuICAgICAgdGhpcy5saXN0T2JqZWN0c1YyUXVlcnkoYnVja2V0TmFtZSwgcHJlZml4LCBjb250aW51YXRpb25Ub2tlbiwgZGVsaW1pdGVyLCAxMDAwLCBzdGFydEFmdGVyKVxuICAgICAgICAub24oJ2Vycm9yJywgKGUpID0+IHJlYWRTdHJlYW0uZW1pdCgnZXJyb3InLCBlKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKHJlc3VsdCkgPT4ge1xuICAgICAgICAgIGlmIChyZXN1bHQuaXNUcnVuY2F0ZWQpIHtcbiAgICAgICAgICAgIGNvbnRpbnVhdGlvblRva2VuID0gcmVzdWx0Lm5leHRDb250aW51YXRpb25Ub2tlblxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBlbmRlZCA9IHRydWVcbiAgICAgICAgICB9XG4gICAgICAgICAgb2JqZWN0cyA9IHJlc3VsdC5vYmplY3RzXG4gICAgICAgICAgcmVhZFN0cmVhbS5fcmVhZCgpXG4gICAgICAgIH0pXG4gICAgfVxuICAgIHJldHVybiByZWFkU3RyZWFtXG4gIH1cblxuICAvLyBSZW1vdmUgYWxsIHRoZSBvYmplY3RzIHJlc2lkaW5nIGluIHRoZSBvYmplY3RzTGlzdC5cbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYG9iamVjdHNMaXN0YCBfYXJyYXlfOiBhcnJheSBvZiBvYmplY3RzIG9mIG9uZSBvZiB0aGUgZm9sbG93aW5nOlxuICAvLyAqICAgICAgICAgTGlzdCBvZiBPYmplY3QgbmFtZXMgYXMgYXJyYXkgb2Ygc3RyaW5ncyB3aGljaCBhcmUgb2JqZWN0IGtleXM6ICBbJ29iamVjdG5hbWUxJywnb2JqZWN0bmFtZTInXVxuICAvLyAqICAgICAgICAgTGlzdCBvZiBPYmplY3QgbmFtZSBhbmQgdmVyc2lvbklkIGFzIGFuIG9iamVjdDogIFt7bmFtZTpcIm9iamVjdG5hbWVcIix2ZXJzaW9uSWQ6XCJteS12ZXJzaW9uLWlkXCJ9XVxuXG4gIHJlbW92ZU9iamVjdHMoYnVja2V0TmFtZSwgb2JqZWN0c0xpc3QsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG9iamVjdHNMaXN0KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignb2JqZWN0c0xpc3Qgc2hvdWxkIGJlIGEgbGlzdCcpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuXG4gICAgY29uc3QgbWF4RW50cmllcyA9IDEwMDBcbiAgICBjb25zdCBxdWVyeSA9ICdkZWxldGUnXG4gICAgY29uc3QgbWV0aG9kID0gJ1BPU1QnXG5cbiAgICBsZXQgcmVzdWx0ID0gb2JqZWN0c0xpc3QucmVkdWNlKFxuICAgICAgKHJlc3VsdCwgZW50cnkpID0+IHtcbiAgICAgICAgcmVzdWx0Lmxpc3QucHVzaChlbnRyeSlcbiAgICAgICAgaWYgKHJlc3VsdC5saXN0Lmxlbmd0aCA9PT0gbWF4RW50cmllcykge1xuICAgICAgICAgIHJlc3VsdC5saXN0T2ZMaXN0LnB1c2gocmVzdWx0Lmxpc3QpXG4gICAgICAgICAgcmVzdWx0Lmxpc3QgPSBbXVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHRcbiAgICAgIH0sXG4gICAgICB7IGxpc3RPZkxpc3Q6IFtdLCBsaXN0OiBbXSB9LFxuICAgIClcblxuICAgIGlmIChyZXN1bHQubGlzdC5sZW5ndGggPiAwKSB7XG4gICAgICByZXN1bHQubGlzdE9mTGlzdC5wdXNoKHJlc3VsdC5saXN0KVxuICAgIH1cblxuICAgIGNvbnN0IGVuY29kZXIgPSBuZXcgVGV4dEVuY29kZXIoKVxuICAgIGNvbnN0IGJhdGNoUmVzdWx0cyA9IFtdXG5cbiAgICBhc3luYy5lYWNoU2VyaWVzKFxuICAgICAgcmVzdWx0Lmxpc3RPZkxpc3QsXG4gICAgICAobGlzdCwgYmF0Y2hDYikgPT4ge1xuICAgICAgICB2YXIgb2JqZWN0cyA9IFtdXG4gICAgICAgIGxpc3QuZm9yRWFjaChmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICBpZiAoaXNPYmplY3QodmFsdWUpKSB7XG4gICAgICAgICAgICBvYmplY3RzLnB1c2goeyBLZXk6IHZhbHVlLm5hbWUsIFZlcnNpb25JZDogdmFsdWUudmVyc2lvbklkIH0pXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG9iamVjdHMucHVzaCh7IEtleTogdmFsdWUgfSlcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICAgIGxldCBkZWxldGVPYmplY3RzID0geyBEZWxldGU6IHsgUXVpZXQ6IHRydWUsIE9iamVjdDogb2JqZWN0cyB9IH1cbiAgICAgICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IGhlYWRsZXNzOiB0cnVlIH0pXG4gICAgICAgIGxldCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChkZWxldGVPYmplY3RzKVxuICAgICAgICBwYXlsb2FkID0gQnVmZmVyLmZyb20oZW5jb2Rlci5lbmNvZGUocGF5bG9hZCkpXG4gICAgICAgIGNvbnN0IGhlYWRlcnMgPSB7fVxuXG4gICAgICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuXG4gICAgICAgIGxldCByZW1vdmVPYmplY3RzUmVzdWx0XG4gICAgICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgaWYgKGUpIHtcbiAgICAgICAgICAgIHJldHVybiBiYXRjaENiKGUpXG4gICAgICAgICAgfVxuICAgICAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXJzLnJlbW92ZU9iamVjdHNUcmFuc2Zvcm1lcigpKVxuICAgICAgICAgICAgLm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICAgICAgICAgICAgcmVtb3ZlT2JqZWN0c1Jlc3VsdCA9IGRhdGFcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAub24oJ2Vycm9yJywgKGUpID0+IHtcbiAgICAgICAgICAgICAgcmV0dXJuIGJhdGNoQ2IoZSwgbnVsbClcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAub24oJ2VuZCcsICgpID0+IHtcbiAgICAgICAgICAgICAgYmF0Y2hSZXN1bHRzLnB1c2gocmVtb3ZlT2JqZWN0c1Jlc3VsdClcbiAgICAgICAgICAgICAgcmV0dXJuIGJhdGNoQ2IobnVsbCwgcmVtb3ZlT2JqZWN0c1Jlc3VsdClcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgICB9LFxuICAgICAgKCkgPT4ge1xuICAgICAgICBjYihudWxsLCBfLmZsYXR0ZW4oYmF0Y2hSZXN1bHRzKSlcbiAgICAgIH0sXG4gICAgKVxuICB9XG5cbiAgLy8gR2V0IHRoZSBwb2xpY3kgb24gYSBidWNrZXQgb3IgYW4gb2JqZWN0IHByZWZpeC5cbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYGNhbGxiYWNrKGVyciwgcG9saWN5KWAgX2Z1bmN0aW9uXzogY2FsbGJhY2sgZnVuY3Rpb25cbiAgZ2V0QnVja2V0UG9saWN5KGJ1Y2tldE5hbWUsIGNiKSB7XG4gICAgLy8gVmFsaWRhdGUgYXJndW1lbnRzLlxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuXG4gICAgbGV0IG1ldGhvZCA9ICdHRVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ3BvbGljeSdcbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuXG4gICAgICBsZXQgcG9saWN5ID0gQnVmZmVyLmZyb20oJycpXG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVycy5nZXRDb25jYXRlcigpKVxuICAgICAgICAub24oJ2RhdGEnLCAoZGF0YSkgPT4gKHBvbGljeSA9IGRhdGEpKVxuICAgICAgICAub24oJ2Vycm9yJywgY2IpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4ge1xuICAgICAgICAgIGNiKG51bGwsIHBvbGljeS50b1N0cmluZygpKVxuICAgICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvLyBTZXQgdGhlIHBvbGljeSBvbiBhIGJ1Y2tldCBvciBhbiBvYmplY3QgcHJlZml4LlxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgYnVja2V0UG9saWN5YCBfc3RyaW5nXzogYnVja2V0IHBvbGljeSAoSlNPTiBzdHJpbmdpZnknZWQpXG4gIC8vICogYGNhbGxiYWNrKGVycilgIF9mdW5jdGlvbl86IGNhbGxiYWNrIGZ1bmN0aW9uXG4gIHNldEJ1Y2tldFBvbGljeShidWNrZXROYW1lLCBwb2xpY3ksIGNiKSB7XG4gICAgLy8gVmFsaWRhdGUgYXJndW1lbnRzLlxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocG9saWN5KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0UG9saWN5RXJyb3IoYEludmFsaWQgYnVja2V0IHBvbGljeTogJHtwb2xpY3l9IC0gbXVzdCBiZSBcInN0cmluZ1wiYClcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICBsZXQgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBsZXQgcXVlcnkgPSAncG9saWN5J1xuXG4gICAgaWYgKHBvbGljeSkge1xuICAgICAgbWV0aG9kID0gJ1BVVCdcbiAgICB9XG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCBwb2xpY3ksIFsyMDRdLCAnJywgZmFsc2UsIGNiKVxuICB9XG5cbiAgLy8gR2VuZXJhdGUgYSBnZW5lcmljIHByZXNpZ25lZCBVUkwgd2hpY2ggY2FuIGJlXG4gIC8vIHVzZWQgZm9yIEhUVFAgbWV0aG9kcyBHRVQsIFBVVCwgSEVBRCBhbmQgREVMRVRFXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgbWV0aG9kYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgSFRUUCBtZXRob2RcbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBvYmplY3ROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0XG4gIC8vICogYGV4cGlyeWAgX251bWJlcl86IGV4cGlyeSBpbiBzZWNvbmRzIChvcHRpb25hbCwgZGVmYXVsdCA3IGRheXMpXG4gIC8vICogYHJlcVBhcmFtc2AgX29iamVjdF86IHJlcXVlc3QgcGFyYW1ldGVycyAob3B0aW9uYWwpIGUuZyB7dmVyc2lvbklkOlwiMTBmYTk5NDYtM2Y2NC00MTM3LWE1OGYtODg4MDY1YzA3MzJlXCJ9XG4gIC8vICogYHJlcXVlc3REYXRlYCBfRGF0ZV86IEEgZGF0ZSBvYmplY3QsIHRoZSB1cmwgd2lsbCBiZSBpc3N1ZWQgYXQgKG9wdGlvbmFsKVxuICBwcmVzaWduZWRVcmwobWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBleHBpcmVzLCByZXFQYXJhbXMsIHJlcXVlc3REYXRlLCBjYikge1xuICAgIGlmICh0aGlzLmFub255bW91cykge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5Bbm9ueW1vdXNSZXF1ZXN0RXJyb3IoJ1ByZXNpZ25lZCAnICsgbWV0aG9kICsgJyB1cmwgY2Fubm90IGJlIGdlbmVyYXRlZCBmb3IgYW5vbnltb3VzIHJlcXVlc3RzJylcbiAgICB9XG4gICAgaWYgKGlzRnVuY3Rpb24ocmVxdWVzdERhdGUpKSB7XG4gICAgICBjYiA9IHJlcXVlc3REYXRlXG4gICAgICByZXF1ZXN0RGF0ZSA9IG5ldyBEYXRlKClcbiAgICB9XG4gICAgaWYgKGlzRnVuY3Rpb24ocmVxUGFyYW1zKSkge1xuICAgICAgY2IgPSByZXFQYXJhbXNcbiAgICAgIHJlcVBhcmFtcyA9IHt9XG4gICAgICByZXF1ZXN0RGF0ZSA9IG5ldyBEYXRlKClcbiAgICB9XG4gICAgaWYgKGlzRnVuY3Rpb24oZXhwaXJlcykpIHtcbiAgICAgIGNiID0gZXhwaXJlc1xuICAgICAgcmVxUGFyYW1zID0ge31cbiAgICAgIGV4cGlyZXMgPSAyNCAqIDYwICogNjAgKiA3IC8vIDcgZGF5cyBpbiBzZWNvbmRzXG4gICAgICByZXF1ZXN0RGF0ZSA9IG5ldyBEYXRlKClcbiAgICB9XG4gICAgaWYgKCFpc051bWJlcihleHBpcmVzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZXhwaXJlcyBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChyZXFQYXJhbXMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXFQYXJhbXMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZERhdGUocmVxdWVzdERhdGUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXF1ZXN0RGF0ZSBzaG91bGQgYmUgb2YgdHlwZSBcIkRhdGVcIiBhbmQgdmFsaWQnKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICB2YXIgcXVlcnkgPSBxdWVyeXN0cmluZy5zdHJpbmdpZnkocmVxUGFyYW1zKVxuICAgIHRoaXMuZ2V0QnVja2V0UmVnaW9uKGJ1Y2tldE5hbWUsIChlLCByZWdpb24pID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuICAgICAgLy8gVGhpcyBzdGF0ZW1lbnQgaXMgYWRkZWQgdG8gZW5zdXJlIHRoYXQgd2Ugc2VuZCBlcnJvciB0aHJvdWdoXG4gICAgICAvLyBjYWxsYmFjayBvbiBwcmVzaWduIGZhaWx1cmUuXG4gICAgICB2YXIgdXJsXG4gICAgICB2YXIgcmVxT3B0aW9ucyA9IHRoaXMuZ2V0UmVxdWVzdE9wdGlvbnMoeyBtZXRob2QsIHJlZ2lvbiwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSlcblxuICAgICAgdGhpcy5jaGVja0FuZFJlZnJlc2hDcmVkcygpXG4gICAgICB0cnkge1xuICAgICAgICB1cmwgPSBwcmVzaWduU2lnbmF0dXJlVjQoXG4gICAgICAgICAgcmVxT3B0aW9ucyxcbiAgICAgICAgICB0aGlzLmFjY2Vzc0tleSxcbiAgICAgICAgICB0aGlzLnNlY3JldEtleSxcbiAgICAgICAgICB0aGlzLnNlc3Npb25Ub2tlbixcbiAgICAgICAgICByZWdpb24sXG4gICAgICAgICAgcmVxdWVzdERhdGUsXG4gICAgICAgICAgZXhwaXJlcyxcbiAgICAgICAgKVxuICAgICAgfSBjYXRjaCAocGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKHBlKVxuICAgICAgfVxuICAgICAgY2IobnVsbCwgdXJsKVxuICAgIH0pXG4gIH1cblxuICAvLyBHZW5lcmF0ZSBhIHByZXNpZ25lZCBVUkwgZm9yIEdFVFxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgb2JqZWN0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBleHBpcnlgIF9udW1iZXJfOiBleHBpcnkgaW4gc2Vjb25kcyAob3B0aW9uYWwsIGRlZmF1bHQgNyBkYXlzKVxuICAvLyAqIGByZXNwSGVhZGVyc2AgX29iamVjdF86IHJlc3BvbnNlIGhlYWRlcnMgdG8gb3ZlcnJpZGUgb3IgcmVxdWVzdCBwYXJhbXMgZm9yIHF1ZXJ5IChvcHRpb25hbCkgZS5nIHt2ZXJzaW9uSWQ6XCIxMGZhOTk0Ni0zZjY0LTQxMzctYTU4Zi04ODgwNjVjMDczMmVcIn1cbiAgLy8gKiBgcmVxdWVzdERhdGVgIF9EYXRlXzogQSBkYXRlIG9iamVjdCwgdGhlIHVybCB3aWxsIGJlIGlzc3VlZCBhdCAob3B0aW9uYWwpXG4gIHByZXNpZ25lZEdldE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBleHBpcmVzLCByZXNwSGVhZGVycywgcmVxdWVzdERhdGUsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoaXNGdW5jdGlvbihyZXNwSGVhZGVycykpIHtcbiAgICAgIGNiID0gcmVzcEhlYWRlcnNcbiAgICAgIHJlc3BIZWFkZXJzID0ge31cbiAgICAgIHJlcXVlc3REYXRlID0gbmV3IERhdGUoKVxuICAgIH1cblxuICAgIHZhciB2YWxpZFJlc3BIZWFkZXJzID0gW1xuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtdHlwZScsXG4gICAgICAncmVzcG9uc2UtY29udGVudC1sYW5ndWFnZScsXG4gICAgICAncmVzcG9uc2UtZXhwaXJlcycsXG4gICAgICAncmVzcG9uc2UtY2FjaGUtY29udHJvbCcsXG4gICAgICAncmVzcG9uc2UtY29udGVudC1kaXNwb3NpdGlvbicsXG4gICAgICAncmVzcG9uc2UtY29udGVudC1lbmNvZGluZycsXG4gICAgXVxuICAgIHZhbGlkUmVzcEhlYWRlcnMuZm9yRWFjaCgoaGVhZGVyKSA9PiB7XG4gICAgICBpZiAocmVzcEhlYWRlcnMgIT09IHVuZGVmaW5lZCAmJiByZXNwSGVhZGVyc1toZWFkZXJdICE9PSB1bmRlZmluZWQgJiYgIWlzU3RyaW5nKHJlc3BIZWFkZXJzW2hlYWRlcl0pKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYHJlc3BvbnNlIGhlYWRlciAke2hlYWRlcn0gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcImApXG4gICAgICB9XG4gICAgfSlcbiAgICByZXR1cm4gdGhpcy5wcmVzaWduZWRVcmwoJ0dFVCcsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGV4cGlyZXMsIHJlc3BIZWFkZXJzLCByZXF1ZXN0RGF0ZSwgY2IpXG4gIH1cblxuICAvLyBHZW5lcmF0ZSBhIHByZXNpZ25lZCBVUkwgZm9yIFBVVC4gVXNpbmcgdGhpcyBVUkwsIHRoZSBicm93c2VyIGNhbiB1cGxvYWQgdG8gUzMgb25seSB3aXRoIHRoZSBzcGVjaWZpZWQgb2JqZWN0IG5hbWUuXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBvYmplY3ROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0XG4gIC8vICogYGV4cGlyeWAgX251bWJlcl86IGV4cGlyeSBpbiBzZWNvbmRzIChvcHRpb25hbCwgZGVmYXVsdCA3IGRheXMpXG4gIHByZXNpZ25lZFB1dE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBleHBpcmVzLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIHJldHVybiB0aGlzLnByZXNpZ25lZFVybCgnUFVUJywgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZXhwaXJlcywgY2IpXG4gIH1cblxuICAvLyByZXR1cm4gUG9zdFBvbGljeSBvYmplY3RcbiAgbmV3UG9zdFBvbGljeSgpIHtcbiAgICByZXR1cm4gbmV3IFBvc3RQb2xpY3koKVxuICB9XG5cbiAgLy8gcHJlc2lnbmVkUG9zdFBvbGljeSBjYW4gYmUgdXNlZCBpbiBzaXR1YXRpb25zIHdoZXJlIHdlIHdhbnQgbW9yZSBjb250cm9sIG9uIHRoZSB1cGxvYWQgdGhhbiB3aGF0XG4gIC8vIHByZXNpZ25lZFB1dE9iamVjdCgpIHByb3ZpZGVzLiBpLmUgVXNpbmcgcHJlc2lnbmVkUG9zdFBvbGljeSB3ZSB3aWxsIGJlIGFibGUgdG8gcHV0IHBvbGljeSByZXN0cmljdGlvbnNcbiAgLy8gb24gdGhlIG9iamVjdCdzIGBuYW1lYCBgYnVja2V0YCBgZXhwaXJ5YCBgQ29udGVudC1UeXBlYCBgQ29udGVudC1EaXNwb3NpdGlvbmAgYG1ldGFEYXRhYFxuICBwcmVzaWduZWRQb3N0UG9saWN5KHBvc3RQb2xpY3ksIGNiKSB7XG4gICAgaWYgKHRoaXMuYW5vbnltb3VzKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkFub255bW91c1JlcXVlc3RFcnJvcignUHJlc2lnbmVkIFBPU1QgcG9saWN5IGNhbm5vdCBiZSBnZW5lcmF0ZWQgZm9yIGFub255bW91cyByZXF1ZXN0cycpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QocG9zdFBvbGljeSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3Bvc3RQb2xpY3kgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NiIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIHRoaXMuZ2V0QnVja2V0UmVnaW9uKHBvc3RQb2xpY3kuZm9ybURhdGEuYnVja2V0LCAoZSwgcmVnaW9uKSA9PiB7XG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gY2IoZSlcbiAgICAgIH1cbiAgICAgIHZhciBkYXRlID0gbmV3IERhdGUoKVxuICAgICAgdmFyIGRhdGVTdHIgPSBtYWtlRGF0ZUxvbmcoZGF0ZSlcblxuICAgICAgdGhpcy5jaGVja0FuZFJlZnJlc2hDcmVkcygpXG5cbiAgICAgIGlmICghcG9zdFBvbGljeS5wb2xpY3kuZXhwaXJhdGlvbikge1xuICAgICAgICAvLyAnZXhwaXJhdGlvbicgaXMgbWFuZGF0b3J5IGZpZWxkIGZvciBTMy5cbiAgICAgICAgLy8gU2V0IGRlZmF1bHQgZXhwaXJhdGlvbiBkYXRlIG9mIDcgZGF5cy5cbiAgICAgICAgdmFyIGV4cGlyZXMgPSBuZXcgRGF0ZSgpXG4gICAgICAgIGV4cGlyZXMuc2V0U2Vjb25kcygyNCAqIDYwICogNjAgKiA3KVxuICAgICAgICBwb3N0UG9saWN5LnNldEV4cGlyZXMoZXhwaXJlcylcbiAgICAgIH1cblxuICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LWRhdGUnLCBkYXRlU3RyXSlcbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LWRhdGUnXSA9IGRhdGVTdHJcblxuICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LWFsZ29yaXRobScsICdBV1M0LUhNQUMtU0hBMjU2J10pXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1hbGdvcml0aG0nXSA9ICdBV1M0LUhNQUMtU0hBMjU2J1xuXG4gICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotY3JlZGVudGlhbCcsIHRoaXMuYWNjZXNzS2V5ICsgJy8nICsgZ2V0U2NvcGUocmVnaW9uLCBkYXRlKV0pXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1jcmVkZW50aWFsJ10gPSB0aGlzLmFjY2Vzc0tleSArICcvJyArIGdldFNjb3BlKHJlZ2lvbiwgZGF0ZSlcblxuICAgICAgaWYgKHRoaXMuc2Vzc2lvblRva2VuKSB7XG4gICAgICAgIHBvc3RQb2xpY3kucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ2VxJywgJyR4LWFtei1zZWN1cml0eS10b2tlbicsIHRoaXMuc2Vzc2lvblRva2VuXSlcbiAgICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotc2VjdXJpdHktdG9rZW4nXSA9IHRoaXMuc2Vzc2lvblRva2VuXG4gICAgICB9XG5cbiAgICAgIHZhciBwb2xpY3lCYXNlNjQgPSBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeShwb3N0UG9saWN5LnBvbGljeSkpLnRvU3RyaW5nKCdiYXNlNjQnKVxuXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhLnBvbGljeSA9IHBvbGljeUJhc2U2NFxuXG4gICAgICB2YXIgc2lnbmF0dXJlID0gcG9zdFByZXNpZ25TaWduYXR1cmVWNChyZWdpb24sIGRhdGUsIHRoaXMuc2VjcmV0S2V5LCBwb2xpY3lCYXNlNjQpXG5cbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LXNpZ25hdHVyZSddID0gc2lnbmF0dXJlXG4gICAgICB2YXIgb3B0cyA9IHt9XG4gICAgICBvcHRzLnJlZ2lvbiA9IHJlZ2lvblxuICAgICAgb3B0cy5idWNrZXROYW1lID0gcG9zdFBvbGljeS5mb3JtRGF0YS5idWNrZXRcbiAgICAgIHZhciByZXFPcHRpb25zID0gdGhpcy5nZXRSZXF1ZXN0T3B0aW9ucyhvcHRzKVxuICAgICAgdmFyIHBvcnRTdHIgPSB0aGlzLnBvcnQgPT0gODAgfHwgdGhpcy5wb3J0ID09PSA0NDMgPyAnJyA6IGA6JHt0aGlzLnBvcnQudG9TdHJpbmcoKX1gXG4gICAgICB2YXIgdXJsU3RyID0gYCR7cmVxT3B0aW9ucy5wcm90b2NvbH0vLyR7cmVxT3B0aW9ucy5ob3N0fSR7cG9ydFN0cn0ke3JlcU9wdGlvbnMucGF0aH1gXG4gICAgICBjYihudWxsLCB7IHBvc3RVUkw6IHVybFN0ciwgZm9ybURhdGE6IHBvc3RQb2xpY3kuZm9ybURhdGEgfSlcbiAgICB9KVxuICB9XG5cbiAgLy8gQ29tcGxldGUgdGhlIG11bHRpcGFydCB1cGxvYWQuIEFmdGVyIGFsbCB0aGUgcGFydHMgYXJlIHVwbG9hZGVkIGlzc3VpbmdcbiAgLy8gdGhpcyBjYWxsIHdpbGwgYWdncmVnYXRlIHRoZSBwYXJ0cyBvbiB0aGUgc2VydmVyIGludG8gYSBzaW5nbGUgb2JqZWN0LlxuICBjb21wbGV0ZU11bHRpcGFydFVwbG9hZChidWNrZXROYW1lLCBvYmplY3ROYW1lLCB1cGxvYWRJZCwgZXRhZ3MsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyh1cGxvYWRJZCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VwbG9hZElkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGV0YWdzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZXRhZ3Mgc2hvdWxkIGJlIG9mIHR5cGUgXCJBcnJheVwiJylcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2Igc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICBpZiAoIXVwbG9hZElkKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd1cGxvYWRJZCBjYW5ub3QgYmUgZW1wdHknKVxuICAgIH1cblxuICAgIHZhciBtZXRob2QgPSAnUE9TVCdcbiAgICB2YXIgcXVlcnkgPSBgdXBsb2FkSWQ9JHt1cmlFc2NhcGUodXBsb2FkSWQpfWBcblxuICAgIHZhciBwYXJ0cyA9IFtdXG5cbiAgICBldGFncy5mb3JFYWNoKChlbGVtZW50KSA9PiB7XG4gICAgICBwYXJ0cy5wdXNoKHtcbiAgICAgICAgUGFydDogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFBhcnROdW1iZXI6IGVsZW1lbnQucGFydCxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIEVUYWc6IGVsZW1lbnQuZXRhZyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgdmFyIHBheWxvYWRPYmplY3QgPSB7IENvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkOiBwYXJ0cyB9XG4gICAgdmFyIHBheWxvYWQgPSBYbWwocGF5bG9hZE9iamVjdClcblxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0sIHBheWxvYWQsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gY2IoZSlcbiAgICAgIH1cbiAgICAgIHZhciB0cmFuc2Zvcm1lciA9IHRyYW5zZm9ybWVycy5nZXRDb21wbGV0ZU11bHRpcGFydFRyYW5zZm9ybWVyKClcbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXIpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gY2IoZSkpXG4gICAgICAgIC5vbignZGF0YScsIChyZXN1bHQpID0+IHtcbiAgICAgICAgICBpZiAocmVzdWx0LmVyckNvZGUpIHtcbiAgICAgICAgICAgIC8vIE11bHRpcGFydCBDb21wbGV0ZSBBUEkgcmV0dXJucyBhbiBlcnJvciBYTUwgYWZ0ZXIgYSAyMDAgaHR0cCBzdGF0dXNcbiAgICAgICAgICAgIGNiKG5ldyBlcnJvcnMuUzNFcnJvcihyZXN1bHQuZXJyTWVzc2FnZSkpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IGNvbXBsZXRlTXVsdGlwYXJ0UmVzdWx0ID0ge1xuICAgICAgICAgICAgICBldGFnOiByZXN1bHQuZXRhZyxcbiAgICAgICAgICAgICAgdmVyc2lvbklkOiBnZXRWZXJzaW9uSWQocmVzcG9uc2UuaGVhZGVycyksXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYihudWxsLCBjb21wbGV0ZU11bHRpcGFydFJlc3VsdClcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8vIENhbGxlZCBieSBsaXN0SW5jb21wbGV0ZVVwbG9hZHMgdG8gZmV0Y2ggYSBiYXRjaCBvZiBpbmNvbXBsZXRlIHVwbG9hZHMuXG4gIGxpc3RJbmNvbXBsZXRlVXBsb2Fkc1F1ZXJ5KGJ1Y2tldE5hbWUsIHByZWZpeCwga2V5TWFya2VyLCB1cGxvYWRJZE1hcmtlciwgZGVsaW1pdGVyKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoa2V5TWFya2VyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigna2V5TWFya2VyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHVwbG9hZElkTWFya2VyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndXBsb2FkSWRNYXJrZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoZGVsaW1pdGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZGVsaW1pdGVyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICB2YXIgcXVlcmllcyA9IFtdXG4gICAgcXVlcmllcy5wdXNoKGBwcmVmaXg9JHt1cmlFc2NhcGUocHJlZml4KX1gKVxuICAgIHF1ZXJpZXMucHVzaChgZGVsaW1pdGVyPSR7dXJpRXNjYXBlKGRlbGltaXRlcil9YClcblxuICAgIGlmIChrZXlNYXJrZXIpIHtcbiAgICAgIGtleU1hcmtlciA9IHVyaUVzY2FwZShrZXlNYXJrZXIpXG4gICAgICBxdWVyaWVzLnB1c2goYGtleS1tYXJrZXI9JHtrZXlNYXJrZXJ9YClcbiAgICB9XG4gICAgaWYgKHVwbG9hZElkTWFya2VyKSB7XG4gICAgICBxdWVyaWVzLnB1c2goYHVwbG9hZC1pZC1tYXJrZXI9JHt1cGxvYWRJZE1hcmtlcn1gKVxuICAgIH1cblxuICAgIHZhciBtYXhVcGxvYWRzID0gMTAwMFxuICAgIHF1ZXJpZXMucHVzaChgbWF4LXVwbG9hZHM9JHttYXhVcGxvYWRzfWApXG4gICAgcXVlcmllcy5zb3J0KClcbiAgICBxdWVyaWVzLnVuc2hpZnQoJ3VwbG9hZHMnKVxuICAgIHZhciBxdWVyeSA9ICcnXG4gICAgaWYgKHF1ZXJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyaWVzLmpvaW4oJyYnKX1gXG4gICAgfVxuICAgIHZhciBtZXRob2QgPSAnR0VUJ1xuICAgIHZhciB0cmFuc2Zvcm1lciA9IHRyYW5zZm9ybWVycy5nZXRMaXN0TXVsdGlwYXJ0VHJhbnNmb3JtZXIoKVxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIHRyYW5zZm9ybWVyLmVtaXQoJ2Vycm9yJywgZSlcbiAgICAgIH1cbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXIpXG4gICAgfSlcbiAgICByZXR1cm4gdHJhbnNmb3JtZXJcbiAgfVxuXG4gIC8vIEZpbmQgdXBsb2FkSWQgb2YgYW4gaW5jb21wbGV0ZSB1cGxvYWQuXG4gIGZpbmRVcGxvYWRJZChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NiIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIHZhciBsYXRlc3RVcGxvYWRcbiAgICB2YXIgbGlzdE5leHQgPSAoa2V5TWFya2VyLCB1cGxvYWRJZE1hcmtlcikgPT4ge1xuICAgICAgdGhpcy5saXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeShidWNrZXROYW1lLCBvYmplY3ROYW1lLCBrZXlNYXJrZXIsIHVwbG9hZElkTWFya2VyLCAnJylcbiAgICAgICAgLm9uKCdlcnJvcicsIChlKSA9PiBjYihlKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKHJlc3VsdCkgPT4ge1xuICAgICAgICAgIHJlc3VsdC51cGxvYWRzLmZvckVhY2goKHVwbG9hZCkgPT4ge1xuICAgICAgICAgICAgaWYgKHVwbG9hZC5rZXkgPT09IG9iamVjdE5hbWUpIHtcbiAgICAgICAgICAgICAgaWYgKCFsYXRlc3RVcGxvYWQgfHwgdXBsb2FkLmluaXRpYXRlZC5nZXRUaW1lKCkgPiBsYXRlc3RVcGxvYWQuaW5pdGlhdGVkLmdldFRpbWUoKSkge1xuICAgICAgICAgICAgICAgIGxhdGVzdFVwbG9hZCA9IHVwbG9hZFxuICAgICAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgICBpZiAocmVzdWx0LmlzVHJ1bmNhdGVkKSB7XG4gICAgICAgICAgICBsaXN0TmV4dChyZXN1bHQubmV4dEtleU1hcmtlciwgcmVzdWx0Lm5leHRVcGxvYWRJZE1hcmtlcilcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAobGF0ZXN0VXBsb2FkKSB7XG4gICAgICAgICAgICByZXR1cm4gY2IobnVsbCwgbGF0ZXN0VXBsb2FkLnVwbG9hZElkKVxuICAgICAgICAgIH1cbiAgICAgICAgICBjYihudWxsLCB1bmRlZmluZWQpXG4gICAgICAgIH0pXG4gICAgfVxuICAgIGxpc3ROZXh0KCcnLCAnJylcbiAgfVxuXG4gIC8vIFJlbW92ZSBhbGwgdGhlIG5vdGlmaWNhdGlvbiBjb25maWd1cmF0aW9ucyBpbiB0aGUgUzMgcHJvdmlkZXJcbiAgc2V0QnVja2V0Tm90aWZpY2F0aW9uKGJ1Y2tldE5hbWUsIGNvbmZpZywgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGNvbmZpZykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ25vdGlmaWNhdGlvbiBjb25maWcgc2hvdWxkIGJlIG9mIHR5cGUgXCJPYmplY3RcIicpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIHZhciBtZXRob2QgPSAnUFVUJ1xuICAgIHZhciBxdWVyeSA9ICdub3RpZmljYXRpb24nXG4gICAgdmFyIGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdOb3RpZmljYXRpb25Db25maWd1cmF0aW9uJyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICB2YXIgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoY29uZmlnKVxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sIHBheWxvYWQsIFsyMDBdLCAnJywgZmFsc2UsIGNiKVxuICB9XG5cbiAgcmVtb3ZlQWxsQnVja2V0Tm90aWZpY2F0aW9uKGJ1Y2tldE5hbWUsIGNiKSB7XG4gICAgdGhpcy5zZXRCdWNrZXROb3RpZmljYXRpb24oYnVja2V0TmFtZSwgbmV3IE5vdGlmaWNhdGlvbkNvbmZpZygpLCBjYilcbiAgfVxuXG4gIC8vIFJldHVybiB0aGUgbGlzdCBvZiBub3RpZmljYXRpb24gY29uZmlndXJhdGlvbnMgc3RvcmVkXG4gIC8vIGluIHRoZSBTMyBwcm92aWRlclxuICBnZXRCdWNrZXROb3RpZmljYXRpb24oYnVja2V0TmFtZSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICB2YXIgbWV0aG9kID0gJ0dFVCdcbiAgICB2YXIgcXVlcnkgPSAnbm90aWZpY2F0aW9uJ1xuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG4gICAgICB2YXIgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMuZ2V0QnVja2V0Tm90aWZpY2F0aW9uVHJhbnNmb3JtZXIoKVxuICAgICAgdmFyIGJ1Y2tldE5vdGlmaWNhdGlvblxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcilcbiAgICAgICAgLm9uKCdkYXRhJywgKHJlc3VsdCkgPT4gKGJ1Y2tldE5vdGlmaWNhdGlvbiA9IHJlc3VsdCkpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gY2IoZSkpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4gY2IobnVsbCwgYnVja2V0Tm90aWZpY2F0aW9uKSlcbiAgICB9KVxuICB9XG5cbiAgLy8gTGlzdGVucyBmb3IgYnVja2V0IG5vdGlmaWNhdGlvbnMuIFJldHVybnMgYW4gRXZlbnRFbWl0dGVyLlxuICBsaXN0ZW5CdWNrZXROb3RpZmljYXRpb24oYnVja2V0TmFtZSwgcHJlZml4LCBzdWZmaXgsIGV2ZW50cykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IG11c3QgYmUgb2YgdHlwZSBzdHJpbmcnKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHN1ZmZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N1ZmZpeCBtdXN0IGJlIG9mIHR5cGUgc3RyaW5nJylcbiAgICB9XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGV2ZW50cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2V2ZW50cyBtdXN0IGJlIG9mIHR5cGUgQXJyYXknKVxuICAgIH1cbiAgICBsZXQgbGlzdGVuZXIgPSBuZXcgTm90aWZpY2F0aW9uUG9sbGVyKHRoaXMsIGJ1Y2tldE5hbWUsIHByZWZpeCwgc3VmZml4LCBldmVudHMpXG4gICAgbGlzdGVuZXIuc3RhcnQoKVxuXG4gICAgcmV0dXJuIGxpc3RlbmVyXG4gIH1cblxuICBnZXRCdWNrZXRWZXJzaW9uaW5nKGJ1Y2tldE5hbWUsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG4gICAgdmFyIG1ldGhvZCA9ICdHRVQnXG4gICAgdmFyIHF1ZXJ5ID0gJ3ZlcnNpb25pbmcnXG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuXG4gICAgICBsZXQgdmVyc2lvbkNvbmZpZyA9IEJ1ZmZlci5mcm9tKCcnKVxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcnMuYnVja2V0VmVyc2lvbmluZ1RyYW5zZm9ybWVyKCkpXG4gICAgICAgIC5vbignZGF0YScsIChkYXRhKSA9PiB7XG4gICAgICAgICAgdmVyc2lvbkNvbmZpZyA9IGRhdGFcbiAgICAgICAgfSlcbiAgICAgICAgLm9uKCdlcnJvcicsIGNiKVxuICAgICAgICAub24oJ2VuZCcsICgpID0+IHtcbiAgICAgICAgICBjYihudWxsLCB2ZXJzaW9uQ29uZmlnKVxuICAgICAgICB9KVxuICAgIH0pXG4gIH1cblxuICBzZXRCdWNrZXRWZXJzaW9uaW5nKGJ1Y2tldE5hbWUsIHZlcnNpb25Db25maWcsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFPYmplY3Qua2V5cyh2ZXJzaW9uQ29uZmlnKS5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3ZlcnNpb25Db25maWcgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuXG4gICAgdmFyIG1ldGhvZCA9ICdQVVQnXG4gICAgdmFyIHF1ZXJ5ID0gJ3ZlcnNpb25pbmcnXG4gICAgdmFyIGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdWZXJzaW9uaW5nQ29uZmlndXJhdGlvbicsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgIH0pXG4gICAgdmFyIHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHZlcnNpb25Db25maWcpXG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCBwYXlsb2FkLCBbMjAwXSwgJycsIGZhbHNlLCBjYilcbiAgfVxuXG4gIC8qKiBUbyBzZXQgVGFncyBvbiBhIGJ1Y2tldCBvciBvYmplY3QgYmFzZWQgb24gdGhlIHBhcmFtc1xuICAgKiAgX19Bcmd1bWVudHNfX1xuICAgKiB0YWdnaW5nUGFyYW1zIF9vYmplY3RfIFdoaWNoIGNvbnRhaW5zIHRoZSBmb2xsb3dpbmcgcHJvcGVydGllc1xuICAgKiAgYnVja2V0TmFtZSBfc3RyaW5nXyxcbiAgICogIG9iamVjdE5hbWUgX3N0cmluZ18gKE9wdGlvbmFsKSxcbiAgICogIHRhZ3MgX29iamVjdF8gb2YgdGhlIGZvcm0geyc8dGFnLWtleS0xPic6Jzx0YWctdmFsdWUtMT4nLCc8dGFnLWtleS0yPic6Jzx0YWctdmFsdWUtMj4nfVxuICAgKiAgcHV0T3B0cyBfb2JqZWN0XyAoT3B0aW9uYWwpIGUuZyB7dmVyc2lvbklkOlwibXktb2JqZWN0LXZlcnNpb24taWRcIn0sXG4gICAqICBjYihlcnJvcilgIF9mdW5jdGlvbl8gLSBjYWxsYmFjayBmdW5jdGlvbiB3aXRoIGBlcnJgIGFzIHRoZSBlcnJvciBhcmd1bWVudC4gYGVycmAgaXMgbnVsbCBpZiB0aGUgb3BlcmF0aW9uIGlzIHN1Y2Nlc3NmdWwuXG4gICAqL1xuICBzZXRUYWdnaW5nKHRhZ2dpbmdQYXJhbXMpIHtcbiAgICBjb25zdCB7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHRhZ3MsIHB1dE9wdHMgPSB7fSwgY2IgfSA9IHRhZ2dpbmdQYXJhbXNcbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGxldCBxdWVyeSA9ICd0YWdnaW5nJ1xuXG4gICAgaWYgKHB1dE9wdHMgJiYgcHV0T3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcnl9JnZlcnNpb25JZD0ke3B1dE9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgdGFnc0xpc3QgPSBbXVxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHRhZ3MpKSB7XG4gICAgICB0YWdzTGlzdC5wdXNoKHsgS2V5OiBrZXksIFZhbHVlOiB2YWx1ZSB9KVxuICAgIH1cbiAgICBjb25zdCB0YWdnaW5nQ29uZmlnID0ge1xuICAgICAgVGFnZ2luZzoge1xuICAgICAgICBUYWdTZXQ6IHtcbiAgICAgICAgICBUYWc6IHRhZ3NMaXN0LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9XG4gICAgY29uc3QgZW5jb2RlciA9IG5ldyBUZXh0RW5jb2RlcigpXG4gICAgY29uc3QgaGVhZGVycyA9IHt9XG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IGhlYWRsZXNzOiB0cnVlLCByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSB9KVxuICAgIGxldCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdCh0YWdnaW5nQ29uZmlnKVxuICAgIHBheWxvYWQgPSBCdWZmZXIuZnJvbShlbmNvZGVyLmVuY29kZShwYXlsb2FkKSlcbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9XG5cbiAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgcmVxdWVzdE9wdGlvbnNbJ29iamVjdE5hbWUnXSA9IG9iamVjdE5hbWVcbiAgICB9XG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHJlcXVlc3RPcHRpb25zLCBwYXlsb2FkLCBbMjAwXSwgJycsIGZhbHNlLCBjYilcbiAgfVxuXG4gIC8qKiBTZXQgVGFncyBvbiBhIEJ1Y2tldFxuICAgKiBfX0FyZ3VtZW50c19fXG4gICAqIGJ1Y2tldE5hbWUgX3N0cmluZ19cbiAgICogdGFncyBfb2JqZWN0XyBvZiB0aGUgZm9ybSB7Jzx0YWcta2V5LTE+JzonPHRhZy12YWx1ZS0xPicsJzx0YWcta2V5LTI+JzonPHRhZy12YWx1ZS0yPid9XG4gICAqIGBjYihlcnJvcilgIF9mdW5jdGlvbl8gLSBjYWxsYmFjayBmdW5jdGlvbiB3aXRoIGBlcnJgIGFzIHRoZSBlcnJvciBhcmd1bWVudC4gYGVycmAgaXMgbnVsbCBpZiB0aGUgb3BlcmF0aW9uIGlzIHN1Y2Nlc3NmdWwuXG4gICAqL1xuICBzZXRCdWNrZXRUYWdnaW5nKGJ1Y2tldE5hbWUsIHRhZ3MsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdCh0YWdzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndGFncyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKE9iamVjdC5rZXlzKHRhZ3MpLmxlbmd0aCA+IDEwKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdtYXhpbXVtIHRhZ3MgYWxsb3dlZCBpcyAxMFwiJylcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5zZXRUYWdnaW5nKHsgYnVja2V0TmFtZSwgdGFncywgY2IgfSlcbiAgfVxuXG4gIC8qKiBTZXQgVGFncyBvbiBhbiBPYmplY3RcbiAgICogX19Bcmd1bWVudHNfX1xuICAgKiBidWNrZXROYW1lIF9zdHJpbmdfXG4gICAqIG9iamVjdE5hbWUgX3N0cmluZ19cbiAgICogICogdGFncyBfb2JqZWN0XyBvZiB0aGUgZm9ybSB7Jzx0YWcta2V5LTE+JzonPHRhZy12YWx1ZS0xPicsJzx0YWcta2V5LTI+JzonPHRhZy12YWx1ZS0yPid9XG4gICAqICBwdXRPcHRzIF9vYmplY3RfIChPcHRpb25hbCkgZS5nIHt2ZXJzaW9uSWQ6XCJteS1vYmplY3QtdmVyc2lvbi1pZFwifSxcbiAgICogYGNiKGVycm9yKWAgX2Z1bmN0aW9uXyAtIGNhbGxiYWNrIGZ1bmN0aW9uIHdpdGggYGVycmAgYXMgdGhlIGVycm9yIGFyZ3VtZW50LiBgZXJyYCBpcyBudWxsIGlmIHRoZSBvcGVyYXRpb24gaXMgc3VjY2Vzc2Z1bC5cbiAgICovXG4gIHNldE9iamVjdFRhZ2dpbmcoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdGFncywgcHV0T3B0cyA9IHt9LCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBvYmplY3QgbmFtZTogJyArIG9iamVjdE5hbWUpXG4gICAgfVxuXG4gICAgaWYgKGlzRnVuY3Rpb24ocHV0T3B0cykpIHtcbiAgICAgIGNiID0gcHV0T3B0c1xuICAgICAgcHV0T3B0cyA9IHt9XG4gICAgfVxuXG4gICAgaWYgKCFpc09iamVjdCh0YWdzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndGFncyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKE9iamVjdC5rZXlzKHRhZ3MpLmxlbmd0aCA+IDEwKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdNYXhpbXVtIHRhZ3MgYWxsb3dlZCBpcyAxMFwiJylcbiAgICB9XG5cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICByZXR1cm4gdGhpcy5zZXRUYWdnaW5nKHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdGFncywgcHV0T3B0cywgY2IgfSlcbiAgfVxuXG4gIC8qKiBSZW1vdmUgVGFncyBvbiBhbiBCdWNrZXQvT2JqZWN0IGJhc2VkIG9uIHBhcmFtc1xuICAgKiBfX0FyZ3VtZW50c19fXG4gICAqIGJ1Y2tldE5hbWUgX3N0cmluZ19cbiAgICogb2JqZWN0TmFtZSBfc3RyaW5nXyAob3B0aW9uYWwpXG4gICAqIHJlbW92ZU9wdHMgX29iamVjdF8gKE9wdGlvbmFsKSBlLmcge3ZlcnNpb25JZDpcIm15LW9iamVjdC12ZXJzaW9uLWlkXCJ9LFxuICAgKiBgY2IoZXJyb3IpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBgZXJyYCBhcyB0aGUgZXJyb3IgYXJndW1lbnQuIGBlcnJgIGlzIG51bGwgaWYgdGhlIG9wZXJhdGlvbiBpcyBzdWNjZXNzZnVsLlxuICAgKi9cbiAgcmVtb3ZlVGFnZ2luZyh7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHJlbW92ZU9wdHMsIGNiIH0pIHtcbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGxldCBxdWVyeSA9ICd0YWdnaW5nJ1xuXG4gICAgaWYgKHJlbW92ZU9wdHMgJiYgT2JqZWN0LmtleXMocmVtb3ZlT3B0cykubGVuZ3RoICYmIHJlbW92ZU9wdHMudmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJ5fSZ2ZXJzaW9uSWQ9JHtyZW1vdmVPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH1cblxuICAgIGlmIChvYmplY3ROYW1lKSB7XG4gICAgICByZXF1ZXN0T3B0aW9uc1snb2JqZWN0TmFtZSddID0gb2JqZWN0TmFtZVxuICAgIH1cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHJlcXVlc3RPcHRpb25zLCAnJywgWzIwMCwgMjA0XSwgJycsIHRydWUsIGNiKVxuICB9XG5cbiAgLyoqIFJlbW92ZSBUYWdzIGFzc29jaWF0ZWQgd2l0aCBhIGJ1Y2tldFxuICAgKiAgX19Bcmd1bWVudHNfX1xuICAgKiBidWNrZXROYW1lIF9zdHJpbmdfXG4gICAqIGBjYihlcnJvcilgIF9mdW5jdGlvbl8gLSBjYWxsYmFjayBmdW5jdGlvbiB3aXRoIGBlcnJgIGFzIHRoZSBlcnJvciBhcmd1bWVudC4gYGVycmAgaXMgbnVsbCBpZiB0aGUgb3BlcmF0aW9uIGlzIHN1Y2Nlc3NmdWwuXG4gICAqL1xuICByZW1vdmVCdWNrZXRUYWdnaW5nKGJ1Y2tldE5hbWUsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMucmVtb3ZlVGFnZ2luZyh7IGJ1Y2tldE5hbWUsIGNiIH0pXG4gIH1cblxuICAvKiogUmVtb3ZlIHRhZ3MgYXNzb2NpYXRlZCB3aXRoIGFuIG9iamVjdFxuICAgKiBfX0FyZ3VtZW50c19fXG4gICAqIGJ1Y2tldE5hbWUgX3N0cmluZ19cbiAgICogb2JqZWN0TmFtZSBfc3RyaW5nX1xuICAgKiByZW1vdmVPcHRzIF9vYmplY3RfIChPcHRpb25hbCkgZS5nLiB7VmVyc2lvbklEOlwibXktb2JqZWN0LXZlcnNpb24taWRcIn1cbiAgICogYGNiKGVycm9yKWAgX2Z1bmN0aW9uXyAtIGNhbGxiYWNrIGZ1bmN0aW9uIHdpdGggYGVycmAgYXMgdGhlIGVycm9yIGFyZ3VtZW50LiBgZXJyYCBpcyBudWxsIGlmIHRoZSBvcGVyYXRpb24gaXMgc3VjY2Vzc2Z1bC5cbiAgICovXG4gIHJlbW92ZU9iamVjdFRhZ2dpbmcoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcmVtb3ZlT3B0cywgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgb2JqZWN0IG5hbWU6ICcgKyBvYmplY3ROYW1lKVxuICAgIH1cbiAgICBpZiAoaXNGdW5jdGlvbihyZW1vdmVPcHRzKSkge1xuICAgICAgY2IgPSByZW1vdmVPcHRzXG4gICAgICByZW1vdmVPcHRzID0ge31cbiAgICB9XG4gICAgaWYgKHJlbW92ZU9wdHMgJiYgT2JqZWN0LmtleXMocmVtb3ZlT3B0cykubGVuZ3RoICYmICFpc09iamVjdChyZW1vdmVPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmVtb3ZlT3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnJlbW92ZVRhZ2dpbmcoeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCByZW1vdmVPcHRzLCBjYiB9KVxuICB9XG5cbiAgLyoqIEdldCBUYWdzIGFzc29jaWF0ZWQgd2l0aCBhIEJ1Y2tldFxuICAgKiAgX19Bcmd1bWVudHNfX1xuICAgKiBidWNrZXROYW1lIF9zdHJpbmdfXG4gICAqIGBjYihlcnJvciwgdGFncylgIF9mdW5jdGlvbl8gLSBjYWxsYmFjayBmdW5jdGlvbiB3aXRoIGBlcnJgIGFzIHRoZSBlcnJvciBhcmd1bWVudC4gYGVycmAgaXMgbnVsbCBpZiB0aGUgb3BlcmF0aW9uIGlzIHN1Y2Nlc3NmdWwuXG4gICAqL1xuICBnZXRCdWNrZXRUYWdnaW5nKGJ1Y2tldE5hbWUsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfVxuXG4gICAgdGhpcy5tYWtlUmVxdWVzdChyZXF1ZXN0T3B0aW9ucywgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICB2YXIgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMuZ2V0VGFnc1RyYW5zZm9ybWVyKClcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuICAgICAgbGV0IHRhZ3NMaXN0XG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVyKVxuICAgICAgICAub24oJ2RhdGEnLCAocmVzdWx0KSA9PiAodGFnc0xpc3QgPSByZXN1bHQpKVxuICAgICAgICAub24oJ2Vycm9yJywgKGUpID0+IGNiKGUpKVxuICAgICAgICAub24oJ2VuZCcsICgpID0+IGNiKG51bGwsIHRhZ3NMaXN0KSlcbiAgICB9KVxuICB9XG5cbiAgLyoqIEdldCB0aGUgdGFncyBhc3NvY2lhdGVkIHdpdGggYSBidWNrZXQgT1IgYW4gb2JqZWN0XG4gICAqIGJ1Y2tldE5hbWUgX3N0cmluZ19cbiAgICogb2JqZWN0TmFtZSBfc3RyaW5nXyAoT3B0aW9uYWwpXG4gICAqIGdldE9wdHMgX29iamVjdF8gKE9wdGlvbmFsKSBlLmcge3ZlcnNpb25JZDpcIm15LW9iamVjdC12ZXJzaW9uLWlkXCJ9XG4gICAqIGBjYihlcnJvciwgdGFncylgIF9mdW5jdGlvbl8gLSBjYWxsYmFjayBmdW5jdGlvbiB3aXRoIGBlcnJgIGFzIHRoZSBlcnJvciBhcmd1bWVudC4gYGVycmAgaXMgbnVsbCBpZiB0aGUgb3BlcmF0aW9uIGlzIHN1Y2Nlc3NmdWwuXG4gICAqL1xuICBnZXRPYmplY3RUYWdnaW5nKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGdldE9wdHMgPSB7fSwgY2IgPSAoKSA9PiBmYWxzZSkge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXG5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgb2JqZWN0IG5hbWU6ICcgKyBvYmplY3ROYW1lKVxuICAgIH1cbiAgICBpZiAoaXNGdW5jdGlvbihnZXRPcHRzKSkge1xuICAgICAgY2IgPSBnZXRPcHRzXG4gICAgICBnZXRPcHRzID0ge31cbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChnZXRPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignZ2V0T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICBpZiAoZ2V0T3B0cyAmJiBnZXRPcHRzLnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyeX0mdmVyc2lvbklkPSR7Z2V0T3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9XG4gICAgaWYgKG9iamVjdE5hbWUpIHtcbiAgICAgIHJlcXVlc3RPcHRpb25zWydvYmplY3ROYW1lJ10gPSBvYmplY3ROYW1lXG4gICAgfVxuXG4gICAgdGhpcy5tYWtlUmVxdWVzdChyZXF1ZXN0T3B0aW9ucywgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICBjb25zdCB0cmFuc2Zvcm1lciA9IHRyYW5zZm9ybWVycy5nZXRUYWdzVHJhbnNmb3JtZXIoKVxuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG4gICAgICBsZXQgdGFnc0xpc3RcbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXIpXG4gICAgICAgIC5vbignZGF0YScsIChyZXN1bHQpID0+ICh0YWdzTGlzdCA9IHJlc3VsdCkpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gY2IoZSkpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4gY2IobnVsbCwgdGFnc0xpc3QpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbHkgbGlmZWN5Y2xlIGNvbmZpZ3VyYXRpb24gb24gYSBidWNrZXQuXG4gICAqIGJ1Y2tldE5hbWUgX3N0cmluZ19cbiAgICogcG9saWN5Q29uZmlnIF9vYmplY3RfIGEgdmFsaWQgcG9saWN5IGNvbmZpZ3VyYXRpb24gb2JqZWN0LlxuICAgKiBgY2IoZXJyb3IpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBgZXJyYCBhcyB0aGUgZXJyb3IgYXJndW1lbnQuIGBlcnJgIGlzIG51bGwgaWYgdGhlIG9wZXJhdGlvbiBpcyBzdWNjZXNzZnVsLlxuICAgKi9cbiAgYXBwbHlCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZSwgcG9saWN5Q29uZmlnLCBjYikge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSAnbGlmZWN5Y2xlJ1xuXG4gICAgY29uc3QgZW5jb2RlciA9IG5ldyBUZXh0RW5jb2RlcigpXG4gICAgY29uc3QgaGVhZGVycyA9IHt9XG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ0xpZmVjeWNsZUNvbmZpZ3VyYXRpb24nLFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICB9KVxuICAgIGxldCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChwb2xpY3lDb25maWcpXG4gICAgcGF5bG9hZCA9IEJ1ZmZlci5mcm9tKGVuY29kZXIuZW5jb2RlKHBheWxvYWQpKVxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH1cbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgIHRoaXMubWFrZVJlcXVlc3QocmVxdWVzdE9wdGlvbnMsIHBheWxvYWQsIFsyMDBdLCAnJywgZmFsc2UsIGNiKVxuICB9XG5cbiAgLyoqIFJlbW92ZSBsaWZlY3ljbGUgY29uZmlndXJhdGlvbiBvZiBhIGJ1Y2tldC5cbiAgICogYnVja2V0TmFtZSBfc3RyaW5nX1xuICAgKiBgY2IoZXJyb3IpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBgZXJyYCBhcyB0aGUgZXJyb3IgYXJndW1lbnQuIGBlcnJgIGlzIG51bGwgaWYgdGhlIG9wZXJhdGlvbiBpcyBzdWNjZXNzZnVsLlxuICAgKi9cbiAgcmVtb3ZlQnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWUsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBjb25zdCBxdWVyeSA9ICdsaWZlY3ljbGUnXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDRdLCAnJywgZmFsc2UsIGNiKVxuICB9XG5cbiAgLyoqIFNldC9PdmVycmlkZSBsaWZlY3ljbGUgY29uZmlndXJhdGlvbiBvbiBhIGJ1Y2tldC4gaWYgdGhlIGNvbmZpZ3VyYXRpb24gaXMgZW1wdHksIGl0IHJlbW92ZXMgdGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqIGJ1Y2tldE5hbWUgX3N0cmluZ19cbiAgICogbGlmZUN5Y2xlQ29uZmlnIF9vYmplY3RfIG9uZSBvZiB0aGUgZm9sbG93aW5nIHZhbHVlczogKG51bGwgb3IgJycpIHRvIHJlbW92ZSB0aGUgbGlmZWN5Y2xlIGNvbmZpZ3VyYXRpb24uIG9yIGEgdmFsaWQgbGlmZWN5Y2xlIGNvbmZpZ3VyYXRpb25cbiAgICogYGNiKGVycm9yKWAgX2Z1bmN0aW9uXyAtIGNhbGxiYWNrIGZ1bmN0aW9uIHdpdGggYGVycmAgYXMgdGhlIGVycm9yIGFyZ3VtZW50LiBgZXJyYCBpcyBudWxsIGlmIHRoZSBvcGVyYXRpb24gaXMgc3VjY2Vzc2Z1bC5cbiAgICovXG4gIHNldEJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lLCBsaWZlQ3ljbGVDb25maWcgPSBudWxsLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmIChfLmlzRW1wdHkobGlmZUN5Y2xlQ29uZmlnKSkge1xuICAgICAgdGhpcy5yZW1vdmVCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZSwgY2IpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuYXBwbHlCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZSwgbGlmZUN5Y2xlQ29uZmlnLCBjYilcbiAgICB9XG4gIH1cblxuICAvKiogR2V0IGxpZmVjeWNsZSBjb25maWd1cmF0aW9uIG9uIGEgYnVja2V0LlxuICAgKiBidWNrZXROYW1lIF9zdHJpbmdfXG4gICAqIGBjYihjb25maWcpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBsaWZlY3ljbGUgY29uZmlndXJhdGlvbiBhcyB0aGUgZXJyb3IgYXJndW1lbnQuXG4gICAqL1xuICBnZXRCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2xpZmVjeWNsZSdcbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9XG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHJlcXVlc3RPcHRpb25zLCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGNvbnN0IHRyYW5zZm9ybWVyID0gdHJhbnNmb3JtZXJzLmxpZmVjeWNsZVRyYW5zZm9ybWVyKClcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuICAgICAgbGV0IGxpZmVjeWNsZUNvbmZpZ1xuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcilcbiAgICAgICAgLm9uKCdkYXRhJywgKHJlc3VsdCkgPT4gKGxpZmVjeWNsZUNvbmZpZyA9IHJlc3VsdCkpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gY2IoZSkpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4gY2IobnVsbCwgbGlmZWN5Y2xlQ29uZmlnKSlcbiAgICB9KVxuICB9XG5cbiAgc2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lLCBsb2NrQ29uZmlnT3B0cyA9IHt9LCBjYikge1xuICAgIGNvbnN0IHJldGVudGlvbk1vZGVzID0gW1JFVEVOVElPTl9NT0RFUy5DT01QTElBTkNFLCBSRVRFTlRJT05fTU9ERVMuR09WRVJOQU5DRV1cbiAgICBjb25zdCB2YWxpZFVuaXRzID0gW1JFVEVOVElPTl9WQUxJRElUWV9VTklUUy5EQVlTLCBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuWUVBUlNdXG5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cblxuICAgIGlmIChsb2NrQ29uZmlnT3B0cy5tb2RlICYmICFyZXRlbnRpb25Nb2Rlcy5pbmNsdWRlcyhsb2NrQ29uZmlnT3B0cy5tb2RlKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgbG9ja0NvbmZpZ09wdHMubW9kZSBzaG91bGQgYmUgb25lIG9mICR7cmV0ZW50aW9uTW9kZXN9YClcbiAgICB9XG4gICAgaWYgKGxvY2tDb25maWdPcHRzLnVuaXQgJiYgIXZhbGlkVW5pdHMuaW5jbHVkZXMobG9ja0NvbmZpZ09wdHMudW5pdCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGxvY2tDb25maWdPcHRzLnVuaXQgc2hvdWxkIGJlIG9uZSBvZiAke3ZhbGlkVW5pdHN9YClcbiAgICB9XG4gICAgaWYgKGxvY2tDb25maWdPcHRzLnZhbGlkaXR5ICYmICFpc051bWJlcihsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGxvY2tDb25maWdPcHRzLnZhbGlkaXR5IHNob3VsZCBiZSBhIG51bWJlcmApXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9ICdvYmplY3QtbG9jaydcblxuICAgIGxldCBjb25maWcgPSB7XG4gICAgICBPYmplY3RMb2NrRW5hYmxlZDogJ0VuYWJsZWQnLFxuICAgIH1cbiAgICBjb25zdCBjb25maWdLZXlzID0gT2JqZWN0LmtleXMobG9ja0NvbmZpZ09wdHMpXG4gICAgLy8gQ2hlY2sgaWYga2V5cyBhcmUgcHJlc2VudCBhbmQgYWxsIGtleXMgYXJlIHByZXNlbnQuXG4gICAgaWYgKGNvbmZpZ0tleXMubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKF8uZGlmZmVyZW5jZShjb25maWdLZXlzLCBbJ3VuaXQnLCAnbW9kZScsICd2YWxpZGl0eSddKS5sZW5ndGggIT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgICBgbG9ja0NvbmZpZ09wdHMubW9kZSxsb2NrQ29uZmlnT3B0cy51bml0LGxvY2tDb25maWdPcHRzLnZhbGlkaXR5IGFsbCB0aGUgcHJvcGVydGllcyBzaG91bGQgYmUgc3BlY2lmaWVkLmAsXG4gICAgICAgIClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbmZpZy5SdWxlID0ge1xuICAgICAgICAgIERlZmF1bHRSZXRlbnRpb246IHt9LFxuICAgICAgICB9XG4gICAgICAgIGlmIChsb2NrQ29uZmlnT3B0cy5tb2RlKSB7XG4gICAgICAgICAgY29uZmlnLlJ1bGUuRGVmYXVsdFJldGVudGlvbi5Nb2RlID0gbG9ja0NvbmZpZ09wdHMubW9kZVxuICAgICAgICB9XG4gICAgICAgIGlmIChsb2NrQ29uZmlnT3B0cy51bml0ID09PSBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuREFZUykge1xuICAgICAgICAgIGNvbmZpZy5SdWxlLkRlZmF1bHRSZXRlbnRpb24uRGF5cyA9IGxvY2tDb25maWdPcHRzLnZhbGlkaXR5XG4gICAgICAgIH0gZWxzZSBpZiAobG9ja0NvbmZpZ09wdHMudW5pdCA9PT0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLllFQVJTKSB7XG4gICAgICAgICAgY29uZmlnLlJ1bGUuRGVmYXVsdFJldGVudGlvbi5ZZWFycyA9IGxvY2tDb25maWdPcHRzLnZhbGlkaXR5XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcbiAgICAgIHJvb3ROYW1lOiAnT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24nLFxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcbiAgICB9KVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KGNvbmZpZylcblxuICAgIGNvbnN0IGhlYWRlcnMgPSB7fVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZCwgWzIwMF0sICcnLCBmYWxzZSwgY2IpXG4gIH1cblxuICBnZXRPYmplY3RMb2NrQ29uZmlnKGJ1Y2tldE5hbWUsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICdvYmplY3QtbG9jaydcblxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG5cbiAgICAgIGxldCBvYmplY3RMb2NrQ29uZmlnID0gQnVmZmVyLmZyb20oJycpXG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVycy5vYmplY3RMb2NrVHJhbnNmb3JtZXIoKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICAgICAgICBvYmplY3RMb2NrQ29uZmlnID0gZGF0YVxuICAgICAgICB9KVxuICAgICAgICAub24oJ2Vycm9yJywgY2IpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4ge1xuICAgICAgICAgIGNiKG51bGwsIG9iamVjdExvY2tDb25maWcpXG4gICAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIHB1dE9iamVjdFJldGVudGlvbihidWNrZXROYW1lLCBvYmplY3ROYW1lLCByZXRlbnRpb25PcHRzID0ge30sIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChyZXRlbnRpb25PcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmV0ZW50aW9uT3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHJldGVudGlvbk9wdHMuZ292ZXJuYW5jZUJ5cGFzcyAmJiAhaXNCb29sZWFuKHJldGVudGlvbk9wdHMuZ292ZXJuYW5jZUJ5cGFzcykpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW52YWxpZCB2YWx1ZSBmb3IgZ292ZXJuYW5jZUJ5cGFzcycsIHJldGVudGlvbk9wdHMuZ292ZXJuYW5jZUJ5cGFzcylcbiAgICAgIH1cbiAgICAgIGlmIChcbiAgICAgICAgcmV0ZW50aW9uT3B0cy5tb2RlICYmXG4gICAgICAgICFbUkVURU5USU9OX01PREVTLkNPTVBMSUFOQ0UsIFJFVEVOVElPTl9NT0RFUy5HT1ZFUk5BTkNFXS5pbmNsdWRlcyhyZXRlbnRpb25PcHRzLm1vZGUpXG4gICAgICApIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW52YWxpZCBvYmplY3QgcmV0ZW50aW9uIG1vZGUgJywgcmV0ZW50aW9uT3B0cy5tb2RlKVxuICAgICAgfVxuICAgICAgaWYgKHJldGVudGlvbk9wdHMucmV0YWluVW50aWxEYXRlICYmICFpc1N0cmluZyhyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW52YWxpZCB2YWx1ZSBmb3IgcmV0YWluVW50aWxEYXRlJywgcmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGUpXG4gICAgICB9XG4gICAgICBpZiAocmV0ZW50aW9uT3B0cy52ZXJzaW9uSWQgJiYgIWlzU3RyaW5nKHJldGVudGlvbk9wdHMudmVyc2lvbklkKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdJbnZhbGlkIHZhbHVlIGZvciB2ZXJzaW9uSWQnLCByZXRlbnRpb25PcHRzLnZlcnNpb25JZClcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGxldCBxdWVyeSA9ICdyZXRlbnRpb24nXG5cbiAgICBjb25zdCBoZWFkZXJzID0ge31cbiAgICBpZiAocmV0ZW50aW9uT3B0cy5nb3Zlcm5hbmNlQnlwYXNzKSB7XG4gICAgICBoZWFkZXJzWydYLUFtei1CeXBhc3MtR292ZXJuYW5jZS1SZXRlbnRpb24nXSA9IHRydWVcbiAgICB9XG5cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHsgcm9vdE5hbWU6ICdSZXRlbnRpb24nLCByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSwgaGVhZGxlc3M6IHRydWUgfSlcbiAgICBjb25zdCBwYXJhbXMgPSB7fVxuXG4gICAgaWYgKHJldGVudGlvbk9wdHMubW9kZSkge1xuICAgICAgcGFyYW1zLk1vZGUgPSByZXRlbnRpb25PcHRzLm1vZGVcbiAgICB9XG4gICAgaWYgKHJldGVudGlvbk9wdHMucmV0YWluVW50aWxEYXRlKSB7XG4gICAgICBwYXJhbXMuUmV0YWluVW50aWxEYXRlID0gcmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGVcbiAgICB9XG4gICAgaWYgKHJldGVudGlvbk9wdHMudmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSArPSBgJnZlcnNpb25JZD0ke3JldGVudGlvbk9wdHMudmVyc2lvbklkfWBcbiAgICB9XG5cbiAgICBsZXQgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QocGFyYW1zKVxuXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZCwgWzIwMCwgMjA0XSwgJycsIGZhbHNlLCBjYilcbiAgfVxuXG4gIGdldE9iamVjdFJldGVudGlvbihidWNrZXROYW1lLCBvYmplY3ROYW1lLCBnZXRPcHRzLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QoZ2V0T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH0gZWxzZSBpZiAoZ2V0T3B0cy52ZXJzaW9uSWQgJiYgIWlzU3RyaW5nKGdldE9wdHMudmVyc2lvbklkKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignVmVyc2lvbklEIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoY2IgJiYgIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGxldCBxdWVyeSA9ICdyZXRlbnRpb24nXG4gICAgaWYgKGdldE9wdHMudmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSArPSBgJnZlcnNpb25JZD0ke2dldE9wdHMudmVyc2lvbklkfWBcbiAgICB9XG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9LCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuXG4gICAgICBsZXQgcmV0ZW50aW9uQ29uZmlnID0gQnVmZmVyLmZyb20oJycpXG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVycy5vYmplY3RSZXRlbnRpb25UcmFuc2Zvcm1lcigpKVxuICAgICAgICAub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xuICAgICAgICAgIHJldGVudGlvbkNvbmZpZyA9IGRhdGFcbiAgICAgICAgfSlcbiAgICAgICAgLm9uKCdlcnJvcicsIGNiKVxuICAgICAgICAub24oJ2VuZCcsICgpID0+IHtcbiAgICAgICAgICBjYihudWxsLCByZXRlbnRpb25Db25maWcpXG4gICAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIHNldEJ1Y2tldEVuY3J5cHRpb24oYnVja2V0TmFtZSwgZW5jcnlwdGlvbkNvbmZpZywgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cblxuICAgIGlmIChpc0Z1bmN0aW9uKGVuY3J5cHRpb25Db25maWcpKSB7XG4gICAgICBjYiA9IGVuY3J5cHRpb25Db25maWdcbiAgICAgIGVuY3J5cHRpb25Db25maWcgPSBudWxsXG4gICAgfVxuXG4gICAgaWYgKCFfLmlzRW1wdHkoZW5jcnlwdGlvbkNvbmZpZykgJiYgZW5jcnlwdGlvbkNvbmZpZy5SdWxlLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0ludmFsaWQgUnVsZSBsZW5ndGguIE9ubHkgb25lIHJ1bGUgaXMgYWxsb3dlZC46ICcgKyBlbmNyeXB0aW9uQ29uZmlnLlJ1bGUpXG4gICAgfVxuICAgIGlmIChjYiAmJiAhaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuXG4gICAgbGV0IGVuY3J5cHRpb25PYmogPSBlbmNyeXB0aW9uQ29uZmlnXG4gICAgaWYgKF8uaXNFbXB0eShlbmNyeXB0aW9uQ29uZmlnKSkge1xuICAgICAgZW5jcnlwdGlvbk9iaiA9IHtcbiAgICAgICAgLy8gRGVmYXVsdCBNaW5JTyBTZXJ2ZXIgU3VwcG9ydGVkIFJ1bGVcbiAgICAgICAgUnVsZTogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIEFwcGx5U2VydmVyU2lkZUVuY3J5cHRpb25CeURlZmF1bHQ6IHtcbiAgICAgICAgICAgICAgU1NFQWxnb3JpdGhtOiAnQUVTMjU2JyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgbWV0aG9kID0gJ1BVVCdcbiAgICBsZXQgcXVlcnkgPSAnZW5jcnlwdGlvbidcbiAgICBsZXQgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ1NlcnZlclNpZGVFbmNyeXB0aW9uQ29uZmlndXJhdGlvbicsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgIH0pXG4gICAgbGV0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KGVuY3J5cHRpb25PYmopXG5cbiAgICBjb25zdCBoZWFkZXJzID0ge31cbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQsIFsyMDBdLCAnJywgZmFsc2UsIGNiKVxuICB9XG5cbiAgZ2V0QnVja2V0RW5jcnlwdGlvbihidWNrZXROYW1lLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAnZW5jcnlwdGlvbidcblxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG5cbiAgICAgIGxldCBidWNrZXRFbmNDb25maWcgPSBCdWZmZXIuZnJvbSgnJylcbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXJzLmJ1Y2tldEVuY3J5cHRpb25UcmFuc2Zvcm1lcigpKVxuICAgICAgICAub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xuICAgICAgICAgIGJ1Y2tldEVuY0NvbmZpZyA9IGRhdGFcbiAgICAgICAgfSlcbiAgICAgICAgLm9uKCdlcnJvcicsIGNiKVxuICAgICAgICAub24oJ2VuZCcsICgpID0+IHtcbiAgICAgICAgICBjYihudWxsLCBidWNrZXRFbmNDb25maWcpXG4gICAgICAgIH0pXG4gICAgfSlcbiAgfVxuICByZW1vdmVCdWNrZXRFbmNyeXB0aW9uKGJ1Y2tldE5hbWUsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBjb25zdCBxdWVyeSA9ICdlbmNyeXB0aW9uJ1xuXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDRdLCAnJywgZmFsc2UsIGNiKVxuICB9XG5cbiAgZ2V0T2JqZWN0TGVnYWxIb2xkKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGdldE9wdHMgPSB7fSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGlmIChpc0Z1bmN0aW9uKGdldE9wdHMpKSB7XG4gICAgICBjYiA9IGdldE9wdHNcbiAgICAgIGdldE9wdHMgPSB7fVxuICAgIH1cblxuICAgIGlmICghaXNPYmplY3QoZ2V0T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2dldE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJPYmplY3RcIicpXG4gICAgfSBlbHNlIGlmIChPYmplY3Qua2V5cyhnZXRPcHRzKS5sZW5ndGggPiAwICYmIGdldE9wdHMudmVyc2lvbklkICYmICFpc1N0cmluZyhnZXRPcHRzLnZlcnNpb25JZCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZlcnNpb25JZCBzaG91bGQgYmUgb2YgdHlwZSBzdHJpbmcuOicsIGdldE9wdHMudmVyc2lvbklkKVxuICAgIH1cblxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBsZXQgcXVlcnkgPSAnbGVnYWwtaG9sZCdcblxuICAgIGlmIChnZXRPcHRzLnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgKz0gYCZ2ZXJzaW9uSWQ9JHtnZXRPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gY2IoZSlcbiAgICAgIH1cblxuICAgICAgbGV0IGxlZ2FsSG9sZENvbmZpZyA9IEJ1ZmZlci5mcm9tKCcnKVxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcnMub2JqZWN0TGVnYWxIb2xkVHJhbnNmb3JtZXIoKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICAgICAgICBsZWdhbEhvbGRDb25maWcgPSBkYXRhXG4gICAgICAgIH0pXG4gICAgICAgIC5vbignZXJyb3InLCBjYilcbiAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgY2IobnVsbCwgbGVnYWxIb2xkQ29uZmlnKVxuICAgICAgICB9KVxuICAgIH0pXG4gIH1cblxuICBzZXRPYmplY3RMZWdhbEhvbGQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgc2V0T3B0cyA9IHt9LCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgZGVmYXVsdE9wdHMgPSB7XG4gICAgICBzdGF0dXM6IExFR0FMX0hPTERfU1RBVFVTLkVOQUJMRUQsXG4gICAgfVxuICAgIGlmIChpc0Z1bmN0aW9uKHNldE9wdHMpKSB7XG4gICAgICBjYiA9IHNldE9wdHNcbiAgICAgIHNldE9wdHMgPSBkZWZhdWx0T3B0c1xuICAgIH1cblxuICAgIGlmICghaXNPYmplY3Qoc2V0T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NldE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJPYmplY3RcIicpXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICghW0xFR0FMX0hPTERfU1RBVFVTLkVOQUJMRUQsIExFR0FMX0hPTERfU1RBVFVTLkRJU0FCTEVEXS5pbmNsdWRlcyhzZXRPcHRzLnN0YXR1cykpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignSW52YWxpZCBzdGF0dXM6ICcgKyBzZXRPcHRzLnN0YXR1cylcbiAgICAgIH1cbiAgICAgIGlmIChzZXRPcHRzLnZlcnNpb25JZCAmJiAhc2V0T3B0cy52ZXJzaW9uSWQubGVuZ3RoKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZlcnNpb25JZCBzaG91bGQgYmUgb2YgdHlwZSBzdHJpbmcuOicgKyBzZXRPcHRzLnZlcnNpb25JZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cblxuICAgIGlmIChfLmlzRW1wdHkoc2V0T3B0cykpIHtcbiAgICAgIHNldE9wdHMgPSB7XG4gICAgICAgIGRlZmF1bHRPcHRzLFxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ2xlZ2FsLWhvbGQnXG5cbiAgICBpZiAoc2V0T3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7c2V0T3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cblxuICAgIGxldCBjb25maWcgPSB7XG4gICAgICBTdGF0dXM6IHNldE9wdHMuc3RhdHVzLFxuICAgIH1cblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByb290TmFtZTogJ0xlZ2FsSG9sZCcsIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LCBoZWFkbGVzczogdHJ1ZSB9KVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KGNvbmZpZylcbiAgICBjb25zdCBoZWFkZXJzID0ge31cbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQsIFsyMDBdLCAnJywgZmFsc2UsIGNiKVxuICB9XG5cbiAgLyoqXG4gICAqIEludGVybmFsIG1ldGhvZCB0byB1cGxvYWQgYSBwYXJ0IGR1cmluZyBjb21wb3NlIG9iamVjdC5cbiAgICogQHBhcmFtIHBhcnRDb25maWcgX19vYmplY3RfXyBjb250YWlucyB0aGUgZm9sbG93aW5nLlxuICAgKiAgICBidWNrZXROYW1lIF9fc3RyaW5nX19cbiAgICogICAgb2JqZWN0TmFtZSBfX3N0cmluZ19fXG4gICAqICAgIHVwbG9hZElEIF9fc3RyaW5nX19cbiAgICogICAgcGFydE51bWJlciBfX251bWJlcl9fXG4gICAqICAgIGhlYWRlcnMgX19vYmplY3RfX1xuICAgKiBAcGFyYW0gY2IgY2FsbGVkIHdpdGggbnVsbCBpbmNhc2Ugb2YgZXJyb3IuXG4gICAqL1xuICB1cGxvYWRQYXJ0Q29weShwYXJ0Q29uZmlnLCBjYikge1xuICAgIGNvbnN0IHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdXBsb2FkSUQsIHBhcnROdW1iZXIsIGhlYWRlcnMgfSA9IHBhcnRDb25maWdcblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgbGV0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7dXBsb2FkSUR9JnBhcnROdW1iZXI9JHtwYXJ0TnVtYmVyfWBcbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lOiBvYmplY3ROYW1lLCBxdWVyeSwgaGVhZGVycyB9XG4gICAgcmV0dXJuIHRoaXMubWFrZVJlcXVlc3QocmVxdWVzdE9wdGlvbnMsICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgbGV0IHBhcnRDb3B5UmVzdWx0ID0gQnVmZmVyLmZyb20oJycpXG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gY2IoZSlcbiAgICAgIH1cbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXJzLnVwbG9hZFBhcnRUcmFuc2Zvcm1lcigpKVxuICAgICAgICAub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xuICAgICAgICAgIHBhcnRDb3B5UmVzdWx0ID0gZGF0YVxuICAgICAgICB9KVxuICAgICAgICAub24oJ2Vycm9yJywgY2IpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4ge1xuICAgICAgICAgIGxldCB1cGxvYWRQYXJ0Q29weVJlcyA9IHtcbiAgICAgICAgICAgIGV0YWc6IHNhbml0aXplRVRhZyhwYXJ0Q29weVJlc3VsdC5FVGFnKSxcbiAgICAgICAgICAgIGtleTogb2JqZWN0TmFtZSxcbiAgICAgICAgICAgIHBhcnQ6IHBhcnROdW1iZXIsXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY2IobnVsbCwgdXBsb2FkUGFydENvcHlSZXMpXG4gICAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIGNvbXBvc2VPYmplY3QoZGVzdE9iakNvbmZpZyA9IHt9LCBzb3VyY2VPYmpMaXN0ID0gW10sIGNiKSB7XG4gICAgY29uc3QgbWUgPSB0aGlzIC8vIG1hbnkgYXN5bmMgZmxvd3MuIHNvIHN0b3JlIHRoZSByZWYuXG4gICAgY29uc3Qgc291cmNlRmlsZXNMZW5ndGggPSBzb3VyY2VPYmpMaXN0Lmxlbmd0aFxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHNvdXJjZU9iakxpc3QpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdzb3VyY2VDb25maWcgc2hvdWxkIGFuIGFycmF5IG9mIENvcHlTb3VyY2VPcHRpb25zICcpXG4gICAgfVxuICAgIGlmICghKGRlc3RPYmpDb25maWcgaW5zdGFuY2VvZiBDb3B5RGVzdGluYXRpb25PcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignZGVzdENvbmZpZyBzaG91bGQgb2YgdHlwZSBDb3B5RGVzdGluYXRpb25PcHRpb25zICcpXG4gICAgfVxuXG4gICAgaWYgKHNvdXJjZUZpbGVzTGVuZ3RoIDwgMSB8fCBzb3VyY2VGaWxlc0xlbmd0aCA+IFBBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICBgXCJUaGVyZSBtdXN0IGJlIGFzIGxlYXN0IG9uZSBhbmQgdXAgdG8gJHtQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVH0gc291cmNlIG9iamVjdHMuYCxcbiAgICAgIClcbiAgICB9XG5cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc291cmNlRmlsZXNMZW5ndGg7IGkrKykge1xuICAgICAgaWYgKCFzb3VyY2VPYmpMaXN0W2ldLnZhbGlkYXRlKCkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFkZXN0T2JqQ29uZmlnLnZhbGlkYXRlKCkpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGNvbnN0IGdldFN0YXRPcHRpb25zID0gKHNyY0NvbmZpZykgPT4ge1xuICAgICAgbGV0IHN0YXRPcHRzID0ge31cbiAgICAgIGlmICghXy5pc0VtcHR5KHNyY0NvbmZpZy5WZXJzaW9uSUQpKSB7XG4gICAgICAgIHN0YXRPcHRzID0ge1xuICAgICAgICAgIHZlcnNpb25JZDogc3JjQ29uZmlnLlZlcnNpb25JRCxcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHN0YXRPcHRzXG4gICAgfVxuICAgIGNvbnN0IHNyY09iamVjdFNpemVzID0gW11cbiAgICBsZXQgdG90YWxTaXplID0gMFxuICAgIGxldCB0b3RhbFBhcnRzID0gMFxuXG4gICAgY29uc3Qgc291cmNlT2JqU3RhdHMgPSBzb3VyY2VPYmpMaXN0Lm1hcCgoc3JjSXRlbSkgPT5cbiAgICAgIG1lLnN0YXRPYmplY3Qoc3JjSXRlbS5CdWNrZXQsIHNyY0l0ZW0uT2JqZWN0LCBnZXRTdGF0T3B0aW9ucyhzcmNJdGVtKSksXG4gICAgKVxuXG4gICAgcmV0dXJuIFByb21pc2UuYWxsKHNvdXJjZU9ialN0YXRzKVxuICAgICAgLnRoZW4oKHNyY09iamVjdEluZm9zKSA9PiB7XG4gICAgICAgIGNvbnN0IHZhbGlkYXRlZFN0YXRzID0gc3JjT2JqZWN0SW5mb3MubWFwKChyZXNJdGVtU3RhdCwgaW5kZXgpID0+IHtcbiAgICAgICAgICBjb25zdCBzcmNDb25maWcgPSBzb3VyY2VPYmpMaXN0W2luZGV4XVxuXG4gICAgICAgICAgbGV0IHNyY0NvcHlTaXplID0gcmVzSXRlbVN0YXQuc2l6ZVxuICAgICAgICAgIC8vIENoZWNrIGlmIGEgc2VnbWVudCBpcyBzcGVjaWZpZWQsIGFuZCBpZiBzbywgaXMgdGhlXG4gICAgICAgICAgLy8gc2VnbWVudCB3aXRoaW4gb2JqZWN0IGJvdW5kcz9cbiAgICAgICAgICBpZiAoc3JjQ29uZmlnLk1hdGNoUmFuZ2UpIHtcbiAgICAgICAgICAgIC8vIFNpbmNlIHJhbmdlIGlzIHNwZWNpZmllZCxcbiAgICAgICAgICAgIC8vICAgIDAgPD0gc3JjLnNyY1N0YXJ0IDw9IHNyYy5zcmNFbmRcbiAgICAgICAgICAgIC8vIHNvIG9ubHkgaW52YWxpZCBjYXNlIHRvIGNoZWNrIGlzOlxuICAgICAgICAgICAgY29uc3Qgc3JjU3RhcnQgPSBzcmNDb25maWcuU3RhcnRcbiAgICAgICAgICAgIGNvbnN0IHNyY0VuZCA9IHNyY0NvbmZpZy5FbmRcbiAgICAgICAgICAgIGlmIChzcmNFbmQgPj0gc3JjQ29weVNpemUgfHwgc3JjU3RhcnQgPCAwKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgICAgICAgYENvcHlTcmNPcHRpb25zICR7aW5kZXh9IGhhcyBpbnZhbGlkIHNlZ21lbnQtdG8tY29weSBbJHtzcmNTdGFydH0sICR7c3JjRW5kfV0gKHNpemUgaXMgJHtzcmNDb3B5U2l6ZX0pYCxcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3JjQ29weVNpemUgPSBzcmNFbmQgLSBzcmNTdGFydCArIDFcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBPbmx5IHRoZSBsYXN0IHNvdXJjZSBtYXkgYmUgbGVzcyB0aGFuIGBhYnNNaW5QYXJ0U2l6ZWBcbiAgICAgICAgICBpZiAoc3JjQ29weVNpemUgPCBQQVJUX0NPTlNUUkFJTlRTLkFCU19NSU5fUEFSVF9TSVpFICYmIGluZGV4IDwgc291cmNlRmlsZXNMZW5ndGggLSAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgICAgICBgQ29weVNyY09wdGlvbnMgJHtpbmRleH0gaXMgdG9vIHNtYWxsICgke3NyY0NvcHlTaXplfSkgYW5kIGl0IGlzIG5vdCB0aGUgbGFzdCBwYXJ0LmAsXG4gICAgICAgICAgICApXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gSXMgZGF0YSB0byBjb3B5IHRvbyBsYXJnZT9cbiAgICAgICAgICB0b3RhbFNpemUgKz0gc3JjQ29weVNpemVcbiAgICAgICAgICBpZiAodG90YWxTaXplID4gUEFSVF9DT05TVFJBSU5UUy5NQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgQ2Fubm90IGNvbXBvc2UgYW4gb2JqZWN0IG9mIHNpemUgJHt0b3RhbFNpemV9ICg+IDVUaUIpYClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyByZWNvcmQgc291cmNlIHNpemVcbiAgICAgICAgICBzcmNPYmplY3RTaXplc1tpbmRleF0gPSBzcmNDb3B5U2l6ZVxuXG4gICAgICAgICAgLy8gY2FsY3VsYXRlIHBhcnRzIG5lZWRlZCBmb3IgY3VycmVudCBzb3VyY2VcbiAgICAgICAgICB0b3RhbFBhcnRzICs9IHBhcnRzUmVxdWlyZWQoc3JjQ29weVNpemUpXG4gICAgICAgICAgLy8gRG8gd2UgbmVlZCBtb3JlIHBhcnRzIHRoYW4gd2UgYXJlIGFsbG93ZWQ/XG4gICAgICAgICAgaWYgKHRvdGFsUGFydHMgPiBQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgICAgICAgYFlvdXIgcHJvcG9zZWQgY29tcG9zZSBvYmplY3QgcmVxdWlyZXMgbW9yZSB0aGFuICR7UEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVFNfQ09VTlR9IHBhcnRzYCxcbiAgICAgICAgICAgIClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gcmVzSXRlbVN0YXRcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoKHRvdGFsUGFydHMgPT09IDEgJiYgdG90YWxTaXplIDw9IFBBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRfU0laRSkgfHwgdG90YWxTaXplID09PSAwKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuY29weU9iamVjdChzb3VyY2VPYmpMaXN0WzBdLCBkZXN0T2JqQ29uZmlnLCBjYikgLy8gdXNlIGNvcHlPYmplY3RWMlxuICAgICAgICB9XG5cbiAgICAgICAgLy8gcHJlc2VydmUgZXRhZyB0byBhdm9pZCBtb2RpZmljYXRpb24gb2Ygb2JqZWN0IHdoaWxlIGNvcHlpbmcuXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc291cmNlRmlsZXNMZW5ndGg7IGkrKykge1xuICAgICAgICAgIHNvdXJjZU9iakxpc3RbaV0uTWF0Y2hFVGFnID0gdmFsaWRhdGVkU3RhdHNbaV0uZXRhZ1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc3BsaXRQYXJ0U2l6ZUxpc3QgPSB2YWxpZGF0ZWRTdGF0cy5tYXAoKHJlc0l0ZW1TdGF0LCBpZHgpID0+IHtcbiAgICAgICAgICBjb25zdCBjYWxTaXplID0gY2FsY3VsYXRlRXZlblNwbGl0cyhzcmNPYmplY3RTaXplc1tpZHhdLCBzb3VyY2VPYmpMaXN0W2lkeF0pXG4gICAgICAgICAgcmV0dXJuIGNhbFNpemVcbiAgICAgICAgfSlcblxuICAgICAgICBmdW5jdGlvbiBnZXRVcGxvYWRQYXJ0Q29uZmlnTGlzdCh1cGxvYWRJZCkge1xuICAgICAgICAgIGNvbnN0IHVwbG9hZFBhcnRDb25maWdMaXN0ID0gW11cblxuICAgICAgICAgIHNwbGl0UGFydFNpemVMaXN0LmZvckVhY2goKHNwbGl0U2l6ZSwgc3BsaXRJbmRleCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgeyBzdGFydEluZGV4OiBzdGFydElkeCwgZW5kSW5kZXg6IGVuZElkeCwgb2JqSW5mbzogb2JqQ29uZmlnIH0gPSBzcGxpdFNpemVcblxuICAgICAgICAgICAgbGV0IHBhcnRJbmRleCA9IHNwbGl0SW5kZXggKyAxIC8vIHBhcnQgaW5kZXggc3RhcnRzIGZyb20gMS5cbiAgICAgICAgICAgIGNvbnN0IHRvdGFsVXBsb2FkcyA9IEFycmF5LmZyb20oc3RhcnRJZHgpXG5cbiAgICAgICAgICAgIGNvbnN0IGhlYWRlcnMgPSBzb3VyY2VPYmpMaXN0W3NwbGl0SW5kZXhdLmdldEhlYWRlcnMoKVxuXG4gICAgICAgICAgICB0b3RhbFVwbG9hZHMuZm9yRWFjaCgoc3BsaXRTdGFydCwgdXBsZEN0cklkeCkgPT4ge1xuICAgICAgICAgICAgICBsZXQgc3BsaXRFbmQgPSBlbmRJZHhbdXBsZEN0cklkeF1cblxuICAgICAgICAgICAgICBjb25zdCBzb3VyY2VPYmogPSBgJHtvYmpDb25maWcuQnVja2V0fS8ke29iakNvbmZpZy5PYmplY3R9YFxuICAgICAgICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZSddID0gYCR7c291cmNlT2JqfWBcbiAgICAgICAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtcmFuZ2UnXSA9IGBieXRlcz0ke3NwbGl0U3RhcnR9LSR7c3BsaXRFbmR9YFxuXG4gICAgICAgICAgICAgIGNvbnN0IHVwbG9hZFBhcnRDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgYnVja2V0TmFtZTogZGVzdE9iakNvbmZpZy5CdWNrZXQsXG4gICAgICAgICAgICAgICAgb2JqZWN0TmFtZTogZGVzdE9iakNvbmZpZy5PYmplY3QsXG4gICAgICAgICAgICAgICAgdXBsb2FkSUQ6IHVwbG9hZElkLFxuICAgICAgICAgICAgICAgIHBhcnROdW1iZXI6IHBhcnRJbmRleCxcbiAgICAgICAgICAgICAgICBoZWFkZXJzOiBoZWFkZXJzLFxuICAgICAgICAgICAgICAgIHNvdXJjZU9iajogc291cmNlT2JqLFxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgdXBsb2FkUGFydENvbmZpZ0xpc3QucHVzaCh1cGxvYWRQYXJ0Q29uZmlnKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9KVxuXG4gICAgICAgICAgcmV0dXJuIHVwbG9hZFBhcnRDb25maWdMaXN0XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwZXJmb3JtVXBsb2FkUGFydHMgPSAodXBsb2FkSWQpID0+IHtcbiAgICAgICAgICBjb25zdCB1cGxvYWRMaXN0ID0gZ2V0VXBsb2FkUGFydENvbmZpZ0xpc3QodXBsb2FkSWQpXG5cbiAgICAgICAgICBhc3luYy5tYXAodXBsb2FkTGlzdCwgbWUudXBsb2FkUGFydENvcHkuYmluZChtZSksIChlcnIsIHJlcykgPT4ge1xuICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICB0aGlzLmFib3J0TXVsdGlwYXJ0VXBsb2FkKGRlc3RPYmpDb25maWcuQnVja2V0LCBkZXN0T2JqQ29uZmlnLk9iamVjdCwgdXBsb2FkSWQpLnRoZW4oXG4gICAgICAgICAgICAgICAgKCkgPT4gY2IoKSxcbiAgICAgICAgICAgICAgICAoZXJyKSA9PiBjYihlcnIpLFxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgcGFydHNEb25lID0gcmVzLm1hcCgocGFydENvcHkpID0+ICh7IGV0YWc6IHBhcnRDb3B5LmV0YWcsIHBhcnQ6IHBhcnRDb3B5LnBhcnQgfSkpXG4gICAgICAgICAgICByZXR1cm4gbWUuY29tcGxldGVNdWx0aXBhcnRVcGxvYWQoZGVzdE9iakNvbmZpZy5CdWNrZXQsIGRlc3RPYmpDb25maWcuT2JqZWN0LCB1cGxvYWRJZCwgcGFydHNEb25lLCBjYilcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbmV3VXBsb2FkSGVhZGVycyA9IGRlc3RPYmpDb25maWcuZ2V0SGVhZGVycygpXG5cbiAgICAgICAgbWUuaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQoZGVzdE9iakNvbmZpZy5CdWNrZXQsIGRlc3RPYmpDb25maWcuT2JqZWN0LCBuZXdVcGxvYWRIZWFkZXJzKS50aGVuKFxuICAgICAgICAgICh1cGxvYWRJZCkgPT4ge1xuICAgICAgICAgICAgcGVyZm9ybVVwbG9hZFBhcnRzKHVwbG9hZElkKVxuICAgICAgICAgIH0sXG4gICAgICAgICAgKGVycikgPT4ge1xuICAgICAgICAgICAgY2IoZXJyLCBudWxsKVxuICAgICAgICAgIH0sXG4gICAgICAgIClcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgIGNiKGVycm9yLCBudWxsKVxuICAgICAgfSlcbiAgfVxuICBzZWxlY3RPYmplY3RDb250ZW50KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHNlbGVjdE9wdHMgPSB7fSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIV8uaXNFbXB0eShzZWxlY3RPcHRzKSkge1xuICAgICAgaWYgKCFpc1N0cmluZyhzZWxlY3RPcHRzLmV4cHJlc3Npb24pKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NxbEV4cHJlc3Npb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgICB9XG4gICAgICBpZiAoIV8uaXNFbXB0eShzZWxlY3RPcHRzLmlucHV0U2VyaWFsaXphdGlvbikpIHtcbiAgICAgICAgaWYgKCFpc09iamVjdChzZWxlY3RPcHRzLmlucHV0U2VyaWFsaXphdGlvbikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdpbnB1dFNlcmlhbGl6YXRpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2lucHV0U2VyaWFsaXphdGlvbiBpcyByZXF1aXJlZCcpXG4gICAgICB9XG4gICAgICBpZiAoIV8uaXNFbXB0eShzZWxlY3RPcHRzLm91dHB1dFNlcmlhbGl6YXRpb24pKSB7XG4gICAgICAgIGlmICghaXNPYmplY3Qoc2VsZWN0T3B0cy5vdXRwdXRTZXJpYWxpemF0aW9uKSkge1xuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ291dHB1dFNlcmlhbGl6YXRpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ291dHB1dFNlcmlhbGl6YXRpb24gaXMgcmVxdWlyZWQnKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2YWxpZCBzZWxlY3QgY29uZmlndXJhdGlvbiBpcyByZXF1aXJlZCcpXG4gICAgfVxuXG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUE9TVCdcbiAgICBsZXQgcXVlcnkgPSBgc2VsZWN0YFxuICAgIHF1ZXJ5ICs9ICcmc2VsZWN0LXR5cGU9MidcblxuICAgIGNvbnN0IGNvbmZpZyA9IFtcbiAgICAgIHtcbiAgICAgICAgRXhwcmVzc2lvbjogc2VsZWN0T3B0cy5leHByZXNzaW9uLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgRXhwcmVzc2lvblR5cGU6IHNlbGVjdE9wdHMuZXhwcmVzc2lvblR5cGUgfHwgJ1NRTCcsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBJbnB1dFNlcmlhbGl6YXRpb246IFtzZWxlY3RPcHRzLmlucHV0U2VyaWFsaXphdGlvbl0sXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBPdXRwdXRTZXJpYWxpemF0aW9uOiBbc2VsZWN0T3B0cy5vdXRwdXRTZXJpYWxpemF0aW9uXSxcbiAgICAgIH0sXG4gICAgXVxuXG4gICAgLy8gT3B0aW9uYWxcbiAgICBpZiAoc2VsZWN0T3B0cy5yZXF1ZXN0UHJvZ3Jlc3MpIHtcbiAgICAgIGNvbmZpZy5wdXNoKHsgUmVxdWVzdFByb2dyZXNzOiBzZWxlY3RPcHRzLnJlcXVlc3RQcm9ncmVzcyB9KVxuICAgIH1cbiAgICAvLyBPcHRpb25hbFxuICAgIGlmIChzZWxlY3RPcHRzLnNjYW5SYW5nZSkge1xuICAgICAgY29uZmlnLnB1c2goeyBTY2FuUmFuZ2U6IHNlbGVjdE9wdHMuc2NhblJhbmdlIH0pXG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ1NlbGVjdE9iamVjdENvbnRlbnRSZXF1ZXN0JyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChjb25maWcpXG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9LCBwYXlsb2FkLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG5cbiAgICAgIGxldCBzZWxlY3RSZXN1bHRcbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXJzLnNlbGVjdE9iamVjdENvbnRlbnRUcmFuc2Zvcm1lcigpKVxuICAgICAgICAub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xuICAgICAgICAgIHNlbGVjdFJlc3VsdCA9IHBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlKGRhdGEpXG4gICAgICAgIH0pXG4gICAgICAgIC5vbignZXJyb3InLCBjYilcbiAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgY2IobnVsbCwgc2VsZWN0UmVzdWx0KVxuICAgICAgICB9KVxuICAgIH0pXG4gIH1cbn1cblxuLy8gUHJvbWlzaWZ5IHZhcmlvdXMgcHVibGljLWZhY2luZyBBUElzIG9uIHRoZSBDbGllbnQgbW9kdWxlLlxuQ2xpZW50LnByb3RvdHlwZS5tYWtlQnVja2V0ID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUubWFrZUJ1Y2tldClcbkNsaWVudC5wcm90b3R5cGUuYnVja2V0RXhpc3RzID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuYnVja2V0RXhpc3RzKVxuXG5DbGllbnQucHJvdG90eXBlLmdldE9iamVjdCA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmdldE9iamVjdClcbkNsaWVudC5wcm90b3R5cGUuZ2V0UGFydGlhbE9iamVjdCA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmdldFBhcnRpYWxPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLmZHZXRPYmplY3QgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5mR2V0T2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5wdXRPYmplY3QgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5wdXRPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLmZQdXRPYmplY3QgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5mUHV0T2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5jb3B5T2JqZWN0ID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuY29weU9iamVjdClcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlT2JqZWN0cyA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZU9iamVjdHMpXG5cbkNsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkVXJsID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkVXJsKVxuQ2xpZW50LnByb3RvdHlwZS5wcmVzaWduZWRHZXRPYmplY3QgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5wcmVzaWduZWRHZXRPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFB1dE9iamVjdCA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFB1dE9iamVjdClcbkNsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkUG9zdFBvbGljeSA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFBvc3RQb2xpY3kpXG5DbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldE5vdGlmaWNhdGlvbiA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldE5vdGlmaWNhdGlvbilcbkNsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0Tm90aWZpY2F0aW9uID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0Tm90aWZpY2F0aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVBbGxCdWNrZXROb3RpZmljYXRpb24gPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVBbGxCdWNrZXROb3RpZmljYXRpb24pXG5DbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldFBvbGljeSA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldFBvbGljeSlcbkNsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0UG9saWN5ID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0UG9saWN5KVxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVJbmNvbXBsZXRlVXBsb2FkID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlSW5jb21wbGV0ZVVwbG9hZClcbkNsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0VmVyc2lvbmluZyA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldFZlcnNpb25pbmcpXG5DbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldFZlcnNpb25pbmcgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRWZXJzaW9uaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRUYWdnaW5nID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0VGFnZ2luZylcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlQnVja2V0VGFnZ2luZyA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldFRhZ2dpbmcpXG5DbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldFRhZ2dpbmcgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRUYWdnaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRPYmplY3RUYWdnaW5nID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuc2V0T2JqZWN0VGFnZ2luZylcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlT2JqZWN0VGFnZ2luZyA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZU9iamVjdFRhZ2dpbmcpXG5DbGllbnQucHJvdG90eXBlLmdldE9iamVjdFRhZ2dpbmcgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3RUYWdnaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRMaWZlY3ljbGUgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRMaWZlY3ljbGUpXG5DbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldExpZmVjeWNsZSA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldExpZmVjeWNsZSlcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlQnVja2V0TGlmZWN5Y2xlID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlQnVja2V0TGlmZWN5Y2xlKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRPYmplY3RMb2NrQ29uZmlnID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuc2V0T2JqZWN0TG9ja0NvbmZpZylcbkNsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0TG9ja0NvbmZpZyA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmdldE9iamVjdExvY2tDb25maWcpXG5DbGllbnQucHJvdG90eXBlLnB1dE9iamVjdFJldGVudGlvbiA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnB1dE9iamVjdFJldGVudGlvbilcbkNsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0UmV0ZW50aW9uID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0UmV0ZW50aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRFbmNyeXB0aW9uID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0RW5jcnlwdGlvbilcbkNsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0RW5jcnlwdGlvbiA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldEVuY3J5cHRpb24pXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldEVuY3J5cHRpb24gPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRFbmNyeXB0aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRPYmplY3RMZWdhbEhvbGQgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5zZXRPYmplY3RMZWdhbEhvbGQpXG5DbGllbnQucHJvdG90eXBlLmdldE9iamVjdExlZ2FsSG9sZCA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmdldE9iamVjdExlZ2FsSG9sZClcbkNsaWVudC5wcm90b3R5cGUuY29tcG9zZU9iamVjdCA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmNvbXBvc2VPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLnNlbGVjdE9iamVjdENvbnRlbnQgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5zZWxlY3RPYmplY3RDb250ZW50KVxuXG4vLyByZWZhY3RvcmVkIEFQSSB1c2UgcHJvbWlzZSBpbnRlcm5hbGx5XG5DbGllbnQucHJvdG90eXBlLnJlbW92ZU9iamVjdCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlT2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5zdGF0T2JqZWN0ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5zdGF0T2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXQgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldClcbkNsaWVudC5wcm90b3R5cGUubGlzdEJ1Y2tldHMgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmxpc3RCdWNrZXRzKVxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRSZXBsaWNhdGlvbiA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlQnVja2V0UmVwbGljYXRpb24pXG5DbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldFJlcGxpY2F0aW9uID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRSZXBsaWNhdGlvbilcbkNsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0UmVwbGljYXRpb24gPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldFJlcGxpY2F0aW9uKVxuIl0sIm1hcHBpbmdzIjoiQUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsT0FBTyxLQUFLQSxFQUFFO0FBQ2QsT0FBTyxLQUFLQyxJQUFJO0FBQ2hCLE9BQU8sS0FBS0MsTUFBTTtBQUVsQixPQUFPQyxLQUFLLE1BQU0sT0FBTztBQUN6QixPQUFPQyxZQUFZLE1BQU0sZUFBZTtBQUN4QyxPQUFPQyxDQUFDLE1BQU0sUUFBUTtBQUN0QixPQUFPLEtBQUtDLFdBQVcsTUFBTSxjQUFjO0FBQzNDLFNBQVNDLFdBQVcsUUFBUSxjQUFjO0FBQzFDLE9BQU9DLEdBQUcsTUFBTSxLQUFLO0FBQ3JCLE9BQU9DLE1BQU0sTUFBTSxRQUFRO0FBRTNCLE9BQU8sS0FBS0MsTUFBTSxNQUFNLGNB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