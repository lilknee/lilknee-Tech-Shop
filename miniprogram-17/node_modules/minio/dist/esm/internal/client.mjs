import * as http from "http";
import * as https from "https";
import { isBrowser } from 'browser-or-node';
import _ from 'lodash';
import * as qs from 'query-string';
import xml2js from 'xml2js';
import { CredentialProvider } from "../CredentialProvider.mjs";
import * as errors from "../errors.mjs";
import { DEFAULT_REGION } from "../helpers.mjs";
import { signV4 } from "../signing.mjs";
import { Extensions } from "./extensions.mjs";
import { extractMetadata, getVersionId, isAmazonEndpoint, isBoolean, isDefined, isEmpty, isNumber, isObject, isReadableStream, isString, isValidBucketName, isValidEndpoint, isValidObjectName, isValidPort, isVirtualHostStyle, makeDateLong, sanitizeETag, toMd5, toSha256, uriEscape, uriResourceEscape } from "./helper.mjs";
import { request } from "./request.mjs";
import { drainResponse, readAsBuffer, readAsString } from "./response.mjs";
import { getS3Endpoint } from "./s3-endpoints.mjs";
import * as xmlParsers from "./xml-parser.mjs";
import { parseInitiateMultipart } from "./xml-parser.mjs";

// will be replaced by bundler.
const Package = {
  version: "7.1.3" || 'development'
};
const requestOptionProperties = ['agent', 'ca', 'cert', 'ciphers', 'clientCertEngine', 'crl', 'dhparam', 'ecdhCurve', 'family', 'honorCipherOrder', 'key', 'passphrase', 'pfx', 'rejectUnauthorized', 'secureOptions', 'secureProtocol', 'servername', 'sessionIdContext'];
export class TypedClient {
  partSize = 64 * 1024 * 1024;
  maximumPartSize = 5 * 1024 * 1024 * 1024;
  maxObjectSize = 5 * 1024 * 1024 * 1024 * 1024;
  constructor(params) {
    // @ts-expect-error deprecated property
    if (params.secure !== undefined) {
      throw new Error('"secure" option deprecated, "useSSL" should be used instead');
    }
    // Default values if not specified.
    if (params.useSSL === undefined) {
      params.useSSL = true;
    }
    if (!params.port) {
      params.port = 0;
    }
    // Validate input params.
    if (!isValidEndpoint(params.endPoint)) {
      throw new errors.InvalidEndpointError(`Invalid endPoint : ${params.endPoint}`);
    }
    if (!isValidPort(params.port)) {
      throw new errors.InvalidArgumentError(`Invalid port : ${params.port}`);
    }
    if (!isBoolean(params.useSSL)) {
      throw new errors.InvalidArgumentError(`Invalid useSSL flag type : ${params.useSSL}, expected to be of type "boolean"`);
    }

    // Validate region only if its set.
    if (params.region) {
      if (!isString(params.region)) {
        throw new errors.InvalidArgumentError(`Invalid region : ${params.region}`);
      }
    }
    const host = params.endPoint.toLowerCase();
    let port = params.port;
    let protocol;
    let transport;
    let transportAgent;
    // Validate if configuration is not using SSL
    // for constructing relevant endpoints.
    if (params.useSSL) {
      // Defaults to secure.
      transport = https;
      protocol = 'https:';
      port = port || 443;
      transportAgent = https.globalAgent;
    } else {
      transport = http;
      protocol = 'http:';
      port = port || 80;
      transportAgent = http.globalAgent;
    }

    // if custom transport is set, use it.
    if (params.transport) {
      if (!isObject(params.transport)) {
        throw new errors.InvalidArgumentError(`Invalid transport type : ${params.transport}, expected to be type "object"`);
      }
      transport = params.transport;
    }

    // if custom transport agent is set, use it.
    if (params.transportAgent) {
      if (!isObject(params.transportAgent)) {
        throw new errors.InvalidArgumentError(`Invalid transportAgent type: ${params.transportAgent}, expected to be type "object"`);
      }
      transportAgent = params.transportAgent;
    }

    // User Agent should always following the below style.
    // Please open an issue to discuss any new changes here.
    //
    //       MinIO (OS; ARCH) LIB/VER APP/VER
    //
    const libraryComments = `(${process.platform}; ${process.arch})`;
    const libraryAgent = `MinIO ${libraryComments} minio-js/${Package.version}`;
    // User agent block ends.

    this.transport = transport;
    this.transportAgent = transportAgent;
    this.host = host;
    this.port = port;
    this.protocol = protocol;
    this.userAgent = `${libraryAgent}`;

    // Default path style is true
    if (params.pathStyle === undefined) {
      this.pathStyle = true;
    } else {
      this.pathStyle = params.pathStyle;
    }
    this.accessKey = params.accessKey ?? '';
    this.secretKey = params.secretKey ?? '';
    this.sessionToken = params.sessionToken;
    this.anonymous = !this.accessKey || !this.secretKey;
    if (params.credentialsProvider) {
      this.credentialsProvider = params.credentialsProvider;
    }
    this.regionMap = {};
    if (params.region) {
      this.region = params.region;
    }
    if (params.partSize) {
      this.partSize = params.partSize;
      this.overRidePartSize = true;
    }
    if (this.partSize < 5 * 1024 * 1024) {
      throw new errors.InvalidArgumentError(`Part size should be greater than 5MB`);
    }
    if (this.partSize > 5 * 1024 * 1024 * 1024) {
      throw new errors.InvalidArgumentError(`Part size should be less than 5GB`);
    }

    // SHA256 is enabled only for authenticated http requests. If the request is authenticated
    // and the connection is https we use x-amz-content-sha256=UNSIGNED-PAYLOAD
    // header for signature calculation.
    this.enableSHA256 = !this.anonymous && !params.useSSL;
    this.s3AccelerateEndpoint = params.s3AccelerateEndpoint || undefined;
    this.reqOptions = {};
    this.clientExtensions = new Extensions(this);
  }

  /**
   * Minio extensions that aren't necessary present for Amazon S3 compatible storage servers
   */
  get extensions() {
    return this.clientExtensions;
  }

  /**
   * @param endPoint - valid S3 acceleration end point
   */
  setS3TransferAccelerate(endPoint) {
    this.s3AccelerateEndpoint = endPoint;
  }

  /**
   * Sets the supported request options.
   */
  setRequestOptions(options) {
    if (!isObject(options)) {
      throw new TypeError('request options should be of type "object"');
    }
    this.reqOptions = _.pick(options, requestOptionProperties);
  }

  /**
   *  This is s3 Specific and does not hold validity in any other Object storage.
   */
  getAccelerateEndPointIfSet(bucketName, objectName) {
    if (!isEmpty(this.s3AccelerateEndpoint) && !isEmpty(bucketName) && !isEmpty(objectName)) {
      // http://docs.aws.amazon.com/AmazonS3/latest/dev/transfer-acceleration.html
      // Disable transfer acceleration for non-compliant bucket names.
      if (bucketName.includes('.')) {
        throw new Error(`Transfer Acceleration is not supported for non compliant bucket:${bucketName}`);
      }
      // If transfer acceleration is requested set new host.
      // For more details about enabling transfer acceleration read here.
      // http://docs.aws.amazon.com/AmazonS3/latest/dev/transfer-acceleration.html
      return this.s3AccelerateEndpoint;
    }
    return false;
  }

  /**
   * returns options object that can be used with http.request()
   * Takes care of constructing virtual-host-style or path-style hostname
   */
  getRequestOptions(opts) {
    const method = opts.method;
    const region = opts.region;
    const bucketName = opts.bucketName;
    let objectName = opts.objectName;
    const headers = opts.headers;
    const query = opts.query;
    let reqOptions = {
      method,
      headers: {},
      protocol: this.protocol,
      // If custom transportAgent was supplied earlier, we'll inject it here
      agent: this.transportAgent
    };

    // Verify if virtual host supported.
    let virtualHostStyle;
    if (bucketName) {
      virtualHostStyle = isVirtualHostStyle(this.host, this.protocol, bucketName, this.pathStyle);
    }
    let path = '/';
    let host = this.host;
    let port;
    if (this.port) {
      port = this.port;
    }
    if (objectName) {
      objectName = uriResourceEscape(objectName);
    }

    // For Amazon S3 endpoint, get endpoint based on region.
    if (isAmazonEndpoint(host)) {
      const accelerateEndPoint = this.getAccelerateEndPointIfSet(bucketName, objectName);
      if (accelerateEndPoint) {
        host = `${accelerateEndPoint}`;
      } else {
        host = getS3Endpoint(region);
      }
    }
    if (virtualHostStyle && !opts.pathStyle) {
      // For all hosts which support virtual host style, `bucketName`
      // is part of the hostname in the following format:
      //
      //  var host = 'bucketName.example.com'
      //
      if (bucketName) {
        host = `${bucketName}.${host}`;
      }
      if (objectName) {
        path = `/${objectName}`;
      }
    } else {
      // For all S3 compatible storage services we will fallback to
      // path style requests, where `bucketName` is part of the URI
      // path.
      if (bucketName) {
        path = `/${bucketName}`;
      }
      if (objectName) {
        path = `/${bucketName}/${objectName}`;
      }
    }
    if (query) {
      path += `?${query}`;
    }
    reqOptions.headers.host = host;
    if (reqOptions.protocol === 'http:' && port !== 80 || reqOptions.protocol === 'https:' && port !== 443) {
      reqOptions.headers.host = `${host}:${port}`;
    }
    reqOptions.headers['user-agent'] = this.userAgent;
    if (headers) {
      // have all header keys in lower case - to make signing easy
      for (const [k, v] of Object.entries(headers)) {
        reqOptions.headers[k.toLowerCase()] = v;
      }
    }

    // Use any request option specified in minioClient.setRequestOptions()
    reqOptions = Object.assign({}, this.reqOptions, reqOptions);
    return {
      ...reqOptions,
      headers: _.mapValues(_.pickBy(reqOptions.headers, isDefined), v => v.toString()),
      host,
      port,
      path
    };
  }
  async setCredentialsProvider(credentialsProvider) {
    if (!(credentialsProvider instanceof CredentialProvider)) {
      throw new Error('Unable to get credentials. Expected instance of CredentialProvider');
    }
    this.credentialsProvider = credentialsProvider;
    await this.checkAndRefreshCreds();
  }
  async checkAndRefreshCreds() {
    if (this.credentialsProvider) {
      try {
        const credentialsConf = await this.credentialsProvider.getCredentials();
        this.accessKey = credentialsConf.getAccessKey();
        this.secretKey = credentialsConf.getSecretKey();
        this.sessionToken = credentialsConf.getSessionToken();
      } catch (e) {
        throw new Error(`Unable to get credentials: ${e}`, {
          cause: e
        });
      }
    }
  }
  /**
   * log the request, response, error
   */
  logHTTP(reqOptions, response, err) {
    // if no logStream available return.
    if (!this.logStream) {
      return;
    }
    if (!isObject(reqOptions)) {
      throw new TypeError('reqOptions should be of type "object"');
    }
    if (response && !isReadableStream(response)) {
      throw new TypeError('response should be of type "Stream"');
    }
    if (err && !(err instanceof Error)) {
      throw new TypeError('err should be of type "Error"');
    }
    const logStream = this.logStream;
    const logHeaders = headers => {
      Object.entries(headers).forEach(([k, v]) => {
        if (k == 'authorization') {
          if (isString(v)) {
            const redactor = new RegExp('Signature=([0-9a-f]+)');
            v = v.replace(redactor, 'Signature=**REDACTED**');
          }
        }
        logStream.write(`${k}: ${v}\n`);
      });
      logStream.write('\n');
    };
    logStream.write(`REQUEST: ${reqOptions.method} ${reqOptions.path}\n`);
    logHeaders(reqOptions.headers);
    if (response) {
      this.logStream.write(`RESPONSE: ${response.statusCode}\n`);
      logHeaders(response.headers);
    }
    if (err) {
      logStream.write('ERROR BODY:\n');
      const errJSON = JSON.stringify(err, null, '\t');
      logStream.write(`${errJSON}\n`);
    }
  }

  /**
   * Enable tracing
   */
  traceOn(stream) {
    if (!stream) {
      stream = process.stdout;
    }
    this.logStream = stream;
  }

  /**
   * Disable tracing
   */
  traceOff() {
    this.logStream = undefined;
  }

  /**
   * makeRequest is the primitive used by the apis for making S3 requests.
   * payload can be empty string in case of no payload.
   * statusCode is the expected statusCode. If response.statusCode does not match
   * we parse the XML error and call the callback with the error message.
   *
   * A valid region is passed by the calls - listBuckets, makeBucket and getBucketRegion.
   *
   * @internal
   */
  async makeRequestAsync(options, payload = '', expectedCodes = [200], region = '') {
    if (!isObject(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!isString(payload) && !isObject(payload)) {
      // Buffer is of type 'object'
      throw new TypeError('payload should be of type "string" or "Buffer"');
    }
    expectedCodes.forEach(statusCode => {
      if (!isNumber(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!isString(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (!options.headers) {
      options.headers = {};
    }
    if (options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE') {
      options.headers['content-length'] = payload.length.toString();
    }
    const sha256sum = this.enableSHA256 ? toSha256(payload) : '';
    return this.makeRequestStreamAsync(options, payload, sha256sum, expectedCodes, region);
  }

  /**
   * new request with promise
   *
   * No need to drain response, response body is not valid
   */
  async makeRequestAsyncOmit(options, payload = '', statusCodes = [200], region = '') {
    const res = await this.makeRequestAsync(options, payload, statusCodes, region);
    await drainResponse(res);
    return res;
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @internal
   */
  async makeRequestStreamAsync(options, body, sha256sum, statusCodes, region) {
    if (!isObject(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!(Buffer.isBuffer(body) || typeof body === 'string' || isReadableStream(body))) {
      throw new errors.InvalidArgumentError(`stream should be a Buffer, string or readable Stream, got ${typeof body} instead`);
    }
    if (!isString(sha256sum)) {
      throw new TypeError('sha256sum should be of type "string"');
    }
    statusCodes.forEach(statusCode => {
      if (!isNumber(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!isString(region)) {
      throw new TypeError('region should be of type "string"');
    }
    // sha256sum will be empty for anonymous or https requests
    if (!this.enableSHA256 && sha256sum.length !== 0) {
      throw new errors.InvalidArgumentError(`sha256sum expected to be empty for anonymous or https requests`);
    }
    // sha256sum should be valid for non-anonymous http requests.
    if (this.enableSHA256 && sha256sum.length !== 64) {
      throw new errors.InvalidArgumentError(`Invalid sha256sum : ${sha256sum}`);
    }
    await this.checkAndRefreshCreds();

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    region = region || (await this.getBucketRegionAsync(options.bucketName));
    const reqOptions = this.getRequestOptions({
      ...options,
      region
    });
    if (!this.anonymous) {
      // For non-anonymous https requests sha256sum is 'UNSIGNED-PAYLOAD' for signature calculation.
      if (!this.enableSHA256) {
        sha256sum = 'UNSIGNED-PAYLOAD';
      }
      const date = new Date();
      reqOptions.headers['x-amz-date'] = makeDateLong(date);
      reqOptions.headers['x-amz-content-sha256'] = sha256sum;
      if (this.sessionToken) {
        reqOptions.headers['x-amz-security-token'] = this.sessionToken;
      }
      reqOptions.headers.authorization = signV4(reqOptions, this.accessKey, this.secretKey, region, date, sha256sum);
    }
    const response = await request(this.transport, reqOptions, body);
    if (!response.statusCode) {
      throw new Error("BUG: response doesn't have a statusCode");
    }
    if (!statusCodes.includes(response.statusCode)) {
      // For an incorrect region, S3 server always sends back 400.
      // But we will do cache invalidation for all errors so that,
      // in future, if AWS S3 decides to send a different status code or
      // XML error code we will still work fine.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      delete this.regionMap[options.bucketName];
      const err = await xmlParsers.parseResponseError(response);
      this.logHTTP(reqOptions, response, err);
      throw err;
    }
    this.logHTTP(reqOptions, response);
    return response;
  }

  /**
   * gets the region of the bucket
   *
   * @param bucketName
   *
   * @internal
   */
  async getBucketRegionAsync(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name : ${bucketName}`);
    }

    // Region is set with constructor, return the region right here.
    if (this.region) {
      return this.region;
    }
    const cached = this.regionMap[bucketName];
    if (cached) {
      return cached;
    }
    const extractRegionAsync = async response => {
      const body = await readAsString(response);
      const region = xmlParsers.parseBucketRegion(body) || DEFAULT_REGION;
      this.regionMap[bucketName] = region;
      return region;
    };
    const method = 'GET';
    const query = 'location';
    // `getBucketLocation` behaves differently in following ways for
    // different environments.
    //
    // - For nodejs env we default to path style requests.
    // - For browser env path style requests on buckets yields CORS
    //   error. To circumvent this problem we make a virtual host
    //   style request signed with 'us-east-1'. This request fails
    //   with an error 'AuthorizationHeaderMalformed', additionally
    //   the error XML also provides Region of the bucket. To validate
    //   this region is proper we retry the same request with the newly
    //   obtained region.
    const pathStyle = this.pathStyle && !isBrowser;
    let region;
    try {
      const res = await this.makeRequestAsync({
        method,
        bucketName,
        query,
        pathStyle
      }, '', [200], DEFAULT_REGION);
      return extractRegionAsync(res);
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (!(e.name === 'AuthorizationHeaderMalformed')) {
        throw e;
      }
      // @ts-expect-error we set extra properties on error object
      region = e.Region;
      if (!region) {
        throw e;
      }
    }
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query,
      pathStyle
    }, '', [200], region);
    return await extractRegionAsync(res);
  }

  /**
   * makeRequest is the primitive used by the apis for making S3 requests.
   * payload can be empty string in case of no payload.
   * statusCode is the expected statusCode. If response.statusCode does not match
   * we parse the XML error and call the callback with the error message.
   * A valid region is passed by the calls - listBuckets, makeBucket and
   * getBucketRegion.
   *
   * @deprecated use `makeRequestAsync` instead
   */
  makeRequest(options, payload = '', expectedCodes = [200], region = '', returnResponse, cb) {
    let prom;
    if (returnResponse) {
      prom = this.makeRequestAsync(options, payload, expectedCodes, region);
    } else {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error compatible for old behaviour
      prom = this.makeRequestAsyncOmit(options, payload, expectedCodes, region);
    }
    prom.then(result => cb(null, result), err => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      cb(err);
    });
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @deprecated use `makeRequestStreamAsync` instead
   */
  makeRequestStream(options, stream, sha256sum, statusCodes, region, returnResponse, cb) {
    const executor = async () => {
      const res = await this.makeRequestStreamAsync(options, stream, sha256sum, statusCodes, region);
      if (!returnResponse) {
        await drainResponse(res);
      }
      return res;
    };
    executor().then(result => cb(null, result),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    err => cb(err));
  }

  /**
   * @deprecated use `getBucketRegionAsync` instead
   */
  getBucketRegion(bucketName, cb) {
    return this.getBucketRegionAsync(bucketName).then(result => cb(null, result),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    err => cb(err));
  }

  /**
   * @deprecated use promise style API
   */

  async removeBucket(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    await this.makeRequestAsyncOmit({
      method,
      bucketName
    }, '', [204]);
    delete this.regionMap[bucketName];
  }

  /**
   * Stat information of the object.
   */
  async statObject(bucketName, objectName, statOpts = {}) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(statOpts)) {
      throw new errors.InvalidArgumentError('statOpts should be of type "object"');
    }
    const query = qs.stringify(statOpts);
    const method = 'HEAD';
    const res = await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query
    });
    return {
      size: parseInt(res.headers['content-length']),
      metaData: extractMetadata(res.headers),
      lastModified: new Date(res.headers['last-modified']),
      versionId: getVersionId(res.headers),
      etag: sanitizeETag(res.headers.etag)
    };
  }

  /**
   * Remove the specified object.
   * @deprecated use new promise style API
   */

  /**
   * @deprecated use new promise style API
   */ // @ts-ignore
  async removeObject(bucketName, objectName, removeOpts = {}) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    const method = 'DELETE';
    const headers = {};
    if (removeOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    if (removeOpts.forceDelete) {
      headers['x-minio-force-delete'] = true;
    }
    const queryParams = {};
    if (removeOpts.versionId) {
      queryParams.versionId = `${removeOpts.versionId}`;
    }
    const query = qs.stringify(queryParams);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      headers,
      query
    }, '', [200, 204]);
  }

  // Calls implemented below are related to multipart.

  /**
   * Initiate a new multipart upload.
   * @internal
   */
  async initiateNewMultipartUpload(bucketName, objectName, headers) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(headers)) {
      throw new errors.InvalidObjectNameError('contentType should be of type "object"');
    }
    const method = 'POST';
    const query = 'uploads';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query,
      headers
    });
    const body = await readAsBuffer(res);
    return parseInitiateMultipart(body.toString());
  }

  /**
   * Internal Method to abort a multipart upload request in case of any errors.
   *
   * @param bucketName - Bucket Name
   * @param objectName - Object Name
   * @param uploadId - id of a multipart upload to cancel during compose object sequence.
   */
  async abortMultipartUpload(bucketName, objectName, uploadId) {
    const method = 'DELETE';
    const query = `uploadId=${uploadId}`;
    const requestOptions = {
      method,
      bucketName,
      objectName: objectName,
      query
    };
    await this.makeRequestAsyncOmit(requestOptions, '', [204]);
  }

  /**
   * Get part-info of all parts of an incomplete upload specified by uploadId.
   */
  async listParts(bucketName, objectName, uploadId) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    const parts = [];
    let marker = 0;
    let result;
    do {
      result = await this.listPartsQuery(bucketName, objectName, uploadId, marker);
      marker = result.marker;
      parts.push(...result.parts);
    } while (result.isTruncated);
    return parts;
  }

  /**
   * Called by listParts to fetch a batch of part-info
   */
  async listPartsQuery(bucketName, objectName, uploadId, marker) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!isNumber(marker)) {
      throw new TypeError('marker should be of type "number"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    let query = `uploadId=${uriEscape(uploadId)}`;
    if (marker) {
      query += `&part-number-marker=${marker}`;
    }
    const method = 'GET';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    });
    return xmlParsers.parseListParts(await readAsString(res));
  }
  async listBuckets() {
    const method = 'GET';
    const httpRes = await this.makeRequestAsync({
      method
    }, '', [200], DEFAULT_REGION);
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseListBucket(xmlResult);
  }
  async removeBucketReplication(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    const query = 'replication';
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, '', [200, 204], '');
  }
  async setBucketReplication(bucketName, replicationConfig) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isObject(replicationConfig)) {
      throw new errors.InvalidArgumentError('replicationConfig should be of type "object"');
    } else {
      if (_.isEmpty(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Role cannot be empty');
      } else if (replicationConfig.role && !isString(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Invalid value for role', replicationConfig.role);
      }
      if (_.isEmpty(replicationConfig.rules)) {
        throw new errors.InvalidArgumentError('Minimum one replication rule must be specified');
      }
    }
    const method = 'PUT';
    const query = 'replication';
    const headers = {};
    const replicationParamsConfig = {
      ReplicationConfiguration: {
        Role: replicationConfig.role,
        Rule: replicationConfig.rules
      }
    };
    const builder = new xml2js.Builder({
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(replicationParamsConfig);
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketReplication(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'replication';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    }, '', [200, 204]);
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseReplicationConfig(xmlResult);
  }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJodHRwIiwiaHR0cHMiLCJpc0Jyb3dzZXIiLCJfIiwicXMiLCJ4bWwyanMiLCJDcmVkZW50aWFsUHJvdmlkZXIiLCJlcnJvcnMiLCJERUZBVUxUX1JFR0lPTiIsInNpZ25WNCIsIkV4dGVuc2lvbnMiLCJleHRyYWN0TWV0YWRhdGEiLCJnZXRWZXJzaW9uSWQiLCJpc0FtYXpvbkVuZHBvaW50IiwiaXNCb29sZWFuIiwiaXNEZWZpbmVkIiwiaXNFbXB0eSIsImlzTnVtYmVyIiwiaXNPYmplY3QiLCJpc1JlYWRhYmxlU3RyZWFtIiwiaXNTdHJpbmciLCJpc1ZhbGlkQnVja2V0TmFtZSIsImlzVmFsaWRFbmRwb2ludCIsImlzVmFsaWRPYmplY3ROYW1lIiwiaXNWYWxpZFBvcnQiLCJpc1ZpcnR1YWxIb3N0U3R5bGUiLCJtYWtlRGF0ZUxvbmciLCJzYW5pdGl6ZUVUYWciLCJ0b01kNSIsInRvU2hhMjU2IiwidXJpRXNjYXBlIiwidXJpUmVzb3VyY2VFc2NhcGUiLCJyZXF1ZXN0IiwiZHJhaW5SZXNwb25zZSIsInJlYWRBc0J1ZmZlciIsInJlYWRBc1N0cmluZyIsImdldFMzRW5kcG9pbnQiLCJ4bWxQYXJzZXJzIiwicGFyc2VJbml0aWF0ZU11bHRpcGFydCIsIlBhY2thZ2UiLCJ2ZXJzaW9uIiwicmVxdWVzdE9wdGlvblByb3BlcnRpZXMiLCJUeXBlZENsaWVudCIsInBhcnRTaXplIiwibWF4aW11bVBhcnRTaXplIiwibWF4T2JqZWN0U2l6ZSIsImNvbnN0cnVjdG9yIiwicGFyYW1zIiwic2VjdXJlIiwidW5kZWZpbmVkIiwiRXJyb3IiLCJ1c2VTU0wiLCJwb3J0IiwiZW5kUG9pbnQiLCJJbnZhbGlkRW5kcG9pbnRFcnJvciIsIkludmFsaWRBcmd1bWVudEVycm9yIiwicmVnaW9uIiwiaG9zdCIsInRvTG93ZXJDYXNlIiwicHJvdG9jb2wiLCJ0cmFuc3BvcnQiLCJ0cmFuc3BvcnRBZ2VudCIsImdsb2JhbEFnZW50IiwibGlicmFyeUNvbW1lbnRzIiwicHJvY2VzcyIsInBsYXRmb3JtIiwiYXJjaCIsImxpYnJhcnlBZ2VudCIsInVzZXJBZ2VudCIsInBhdGhTdHlsZSIsImFjY2Vzc0tleSIsInNlY3JldEtleSIsInNlc3Npb25Ub2tlbiIsImFub255bW91cyIsImNyZWRlbnRpYWxzUHJvdmlkZXIiLCJyZWdpb25NYXAiLCJvdmVyUmlkZVBhcnRTaXplIiwiZW5hYmxlU0hBMjU2IiwiczNBY2NlbGVyYXRlRW5kcG9pbnQiLCJyZXFPcHRpb25zIiwiY2xpZW50RXh0ZW5zaW9ucyIsImV4dGVuc2lvbnMiLCJzZXRTM1RyYW5zZmVyQWNjZWxlcmF0ZSIsInNldFJlcXVlc3RPcHRpb25zIiwib3B0aW9ucyIsIlR5cGVFcnJvciIsInBpY2siLCJnZXRBY2NlbGVyYXRlRW5kUG9pbnRJZlNldCIsImJ1Y2tldE5hbWUiLCJvYmplY3ROYW1lIiwiaW5jbHVkZXMiLCJnZXRSZXF1ZXN0T3B0aW9ucyIsIm9wdHMiLCJtZXRob2QiLCJoZWFkZXJzIiwicXVlcnkiLCJhZ2VudCIsInZpcnR1YWxIb3N0U3R5bGUiLCJwYXRoIiwiYWNjZWxlcmF0ZUVuZFBvaW50IiwiayIsInYiLCJPYmplY3QiLCJlbnRyaWVzIiwiYXNzaWduIiwibWFwVmFsdWVzIiwicGlja0J5IiwidG9TdHJpbmciLCJzZXRDcmVkZW50aWFsc1Byb3ZpZGVyIiwiY2hlY2tBbmRSZWZyZXNoQ3JlZHMiLCJjcmVkZW50aWFsc0NvbmYiLCJnZXRDcmVkZW50aWFscyIsImdldEFjY2Vzc0tleSIsImdldFNlY3JldEtleSIsImdldFNlc3Npb25Ub2tlbiIsImUiLCJjYXVzZSIsImxvZ0hUVFAiLCJyZXNwb25zZSIsImVyciIsImxvZ1N0cmVhbSIsImxvZ0hlYWRlcnMiLCJmb3JFYWNoIiwicmVkYWN0b3IiLCJSZWdFeHAiLCJyZXBsYWNlIiwid3JpdGUiLCJzdGF0dXNDb2RlIiwiZXJySlNPTiIsIkpTT04iLCJzdHJpbmdpZnkiLCJ0cmFjZU9uIiwic3RyZWFtIiwic3Rkb3V0IiwidHJhY2VPZmYiLCJtYWtlUmVxdWVzdEFzeW5jIiwicGF5bG9hZCIsImV4cGVjdGVkQ29kZXMiLCJsZW5ndGgiLCJzaGEyNTZzdW0iLCJtYWtlUmVxdWVzdFN0cmVhbUFzeW5jIiwibWFrZVJlcXVlc3RBc3luY09taXQiLCJzdGF0dXNDb2RlcyIsInJlcyIsImJvZHkiLCJCdWZmZXIiLCJpc0J1ZmZlciIsImdldEJ1Y2tldFJlZ2lvbkFzeW5jIiwiZGF0ZSIsIkRhdGUiLCJhdXRob3JpemF0aW9uIiwicGFyc2VSZXNwb25zZUVycm9yIiwiSW52YWxpZEJ1Y2tldE5hbWVFcnJvciIsImNhY2hlZCIsImV4dHJhY3RSZWdpb25Bc3luYyIsInBhcnNlQnVja2V0UmVnaW9uIiwibmFtZSIsIlJlZ2lvbiIsIm1ha2VSZXF1ZXN0IiwicmV0dXJuUmVzcG9uc2UiLCJjYiIsInByb20iLCJ0aGVuIiwicmVzdWx0IiwibWFrZVJlcXVlc3RTdHJlYW0iLCJleGVjdXRvciIsImdldEJ1Y2tldFJlZ2lvbiIsInJlbW92ZUJ1Y2tldCIsInN0YXRPYmplY3QiLCJzdGF0T3B0cyIsIkludmFsaWRPYmplY3ROYW1lRXJyb3IiLCJzaXplIiwicGFyc2VJbnQiLCJtZXRhRGF0YSIsImxhc3RNb2RpZmllZCIsInZlcnNpb25JZCIsImV0YWciLCJyZW1vdmVPYmplY3QiLCJyZW1vdmVPcHRzIiwiZ292ZXJuYW5jZUJ5cGFzcyIsImZvcmNlRGVsZXRlIiwicXVlcnlQYXJhbXMiLCJpbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZCIsImFib3J0TXVsdGlwYXJ0VXBsb2FkIiwidXBsb2FkSWQiLCJyZXF1ZXN0T3B0aW9ucyIsImxpc3RQYXJ0cyIsInBhcnRzIiwibWFya2VyIiwibGlzdFBhcnRzUXVlcnkiLCJwdXNoIiwiaXNUcnVuY2F0ZWQiLCJwYXJzZUxpc3RQYXJ0cyIsImxpc3RCdWNrZXRzIiwiaHR0cFJlcyIsInhtbFJlc3VsdCIsInBhcnNlTGlzdEJ1Y2tldCIsInJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uIiwic2V0QnVja2V0UmVwbGljYXRpb24iLCJyZXBsaWNhdGlvbkNvbmZpZyIsInJvbGUiLCJydWxlcyIsInJlcGxpY2F0aW9uUGFyYW1zQ29uZmlnIiwiUmVwbGljYXRpb25Db25maWd1cmF0aW9uIiwiUm9sZSIsIlJ1bGUiLCJidWlsZGVyIiwiQnVpbGRlciIsInJlbmRlck9wdHMiLCJwcmV0dHkiLCJoZWFkbGVzcyIsImJ1aWxkT2JqZWN0IiwiZ2V0QnVja2V0UmVwbGljYXRpb24iLCJwYXJzZVJlcGxpY2F0aW9uQ29uZmlnIl0sInNvdXJjZXMiOlsiY2xpZW50LnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGh0dHAgZnJvbSAnbm9kZTpodHRwJ1xuaW1wb3J0ICogYXMgaHR0cHMgZnJvbSAnbm9kZTpodHRwcydcbmltcG9ydCB0eXBlICogYXMgc3RyZWFtIGZyb20gJ25vZGU6c3RyZWFtJ1xuXG5pbXBvcnQgeyBpc0Jyb3dzZXIgfSBmcm9tICdicm93c2VyLW9yLW5vZGUnXG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnXG5pbXBvcnQgKiBhcyBxcyBmcm9tICdxdWVyeS1zdHJpbmcnXG5pbXBvcnQgeG1sMmpzIGZyb20gJ3htbDJqcydcblxuaW1wb3J0IHsgQ3JlZGVudGlhbFByb3ZpZGVyIH0gZnJvbSAnLi4vQ3JlZGVudGlhbFByb3ZpZGVyLnRzJ1xuaW1wb3J0ICogYXMgZXJyb3JzIGZyb20gJy4uL2Vycm9ycy50cydcbmltcG9ydCB7IERFRkFVTFRfUkVHSU9OIH0gZnJvbSAnLi4vaGVscGVycy50cydcbmltcG9ydCB7IHNpZ25WNCB9IGZyb20gJy4uL3NpZ25pbmcudHMnXG5pbXBvcnQgeyBFeHRlbnNpb25zIH0gZnJvbSAnLi9leHRlbnNpb25zLnRzJ1xuaW1wb3J0IHtcbiAgZXh0cmFjdE1ldGFkYXRhLFxuICBnZXRWZXJzaW9uSWQsXG4gIGlzQW1hem9uRW5kcG9pbnQsXG4gIGlzQm9vbGVhbixcbiAgaXNEZWZpbmVkLFxuICBpc0VtcHR5LFxuICBpc051bWJlcixcbiAgaXNPYmplY3QsXG4gIGlzUmVhZGFibGVTdHJlYW0sXG4gIGlzU3RyaW5nLFxuICBpc1ZhbGlkQnVja2V0TmFtZSxcbiAgaXNWYWxpZEVuZHBvaW50LFxuICBpc1ZhbGlkT2JqZWN0TmFtZSxcbiAgaXNWYWxpZFBvcnQsXG4gIGlzVmlydHVhbEhvc3RTdHlsZSxcbiAgbWFrZURhdGVMb25nLFxuICBzYW5pdGl6ZUVUYWcsXG4gIHRvTWQ1LFxuICB0b1NoYTI1NixcbiAgdXJpRXNjYXBlLFxuICB1cmlSZXNvdXJjZUVzY2FwZSxcbn0gZnJvbSAnLi9oZWxwZXIudHMnXG5pbXBvcnQgeyByZXF1ZXN0IH0gZnJvbSAnLi9yZXF1ZXN0LnRzJ1xuaW1wb3J0IHsgZHJhaW5SZXNwb25zZSwgcmVhZEFzQnVmZmVyLCByZWFkQXNTdHJpbmcgfSBmcm9tICcuL3Jlc3BvbnNlLnRzJ1xuaW1wb3J0IHR5cGUgeyBSZWdpb24gfSBmcm9tICcuL3MzLWVuZHBvaW50cy50cydcbmltcG9ydCB7IGdldFMzRW5kcG9pbnQgfSBmcm9tICcuL3MzLWVuZHBvaW50cy50cydcbmltcG9ydCB0eXBlIHtcbiAgQmluYXJ5LFxuICBCdWNrZXRJdGVtRnJvbUxpc3QsXG4gIEJ1Y2tldEl0ZW1TdGF0LFxuICBJUmVxdWVzdCxcbiAgUmVwbGljYXRpb25Db25maWcsXG4gIFJlcGxpY2F0aW9uQ29uZmlnT3B0cyxcbiAgUmVxdWVzdEhlYWRlcnMsXG4gIFJlc3BvbnNlSGVhZGVyLFxuICBSZXN1bHRDYWxsYmFjayxcbiAgU3RhdE9iamVjdE9wdHMsXG4gIFRyYW5zcG9ydCxcbn0gZnJvbSAnLi90eXBlLnRzJ1xuaW1wb3J0IHR5cGUgeyBVcGxvYWRlZFBhcnQgfSBmcm9tICcuL3htbC1wYXJzZXIudHMnXG5pbXBvcnQgKiBhcyB4bWxQYXJzZXJzIGZyb20gJy4veG1sLXBhcnNlci50cydcbmltcG9ydCB7IHBhcnNlSW5pdGlhdGVNdWx0aXBhcnQgfSBmcm9tICcuL3htbC1wYXJzZXIudHMnXG5cbi8vIHdpbGwgYmUgcmVwbGFjZWQgYnkgYnVuZGxlci5cbmNvbnN0IFBhY2thZ2UgPSB7IHZlcnNpb246IHByb2Nlc3MuZW52Lk1JTklPX0pTX1BBQ0tBR0VfVkVSU0lPTiB8fCAnZGV2ZWxvcG1lbnQnIH1cblxuY29uc3QgcmVxdWVzdE9wdGlvblByb3BlcnRpZXMgPSBbXG4gICdhZ2VudCcsXG4gICdjYScsXG4gICdjZXJ0JyxcbiAgJ2NpcGhlcnMnLFxuICAnY2xpZW50Q2VydEVuZ2luZScsXG4gICdjcmwnLFxuICAnZGhwYXJhbScsXG4gICdlY2RoQ3VydmUnLFxuICAnZmFtaWx5JyxcbiAgJ2hvbm9yQ2lwaGVyT3JkZXInLFxuICAna2V5JyxcbiAgJ3Bhc3NwaHJhc2UnLFxuICAncGZ4JyxcbiAgJ3JlamVjdFVuYXV0aG9yaXplZCcsXG4gICdzZWN1cmVPcHRpb25zJyxcbiAgJ3NlY3VyZVByb3RvY29sJyxcbiAgJ3NlcnZlcm5hbWUnLFxuICAnc2Vzc2lvbklkQ29udGV4dCcsXG5dIGFzIGNvbnN0XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2xpZW50T3B0aW9ucyB7XG4gIGVuZFBvaW50OiBzdHJpbmdcbiAgYWNjZXNzS2V5OiBzdHJpbmdcbiAgc2VjcmV0S2V5OiBzdHJpbmdcbiAgdXNlU1NMPzogYm9vbGVhblxuICBwb3J0PzogbnVtYmVyXG4gIHJlZ2lvbj86IFJlZ2lvblxuICB0cmFuc3BvcnQ/OiBUcmFuc3BvcnRcbiAgc2Vzc2lvblRva2VuPzogc3RyaW5nXG4gIHBhcnRTaXplPzogbnVtYmVyXG4gIHBhdGhTdHlsZT86IGJvb2xlYW5cbiAgY3JlZGVudGlhbHNQcm92aWRlcj86IENyZWRlbnRpYWxQcm92aWRlclxuICBzM0FjY2VsZXJhdGVFbmRwb2ludD86IHN0cmluZ1xuICB0cmFuc3BvcnRBZ2VudD86IGh0dHAuQWdlbnRcbn1cblxuZXhwb3J0IHR5cGUgUmVxdWVzdE9wdGlvbiA9IFBhcnRpYWw8SVJlcXVlc3Q+ICYge1xuICBtZXRob2Q6IHN0cmluZ1xuICBidWNrZXROYW1lPzogc3RyaW5nXG4gIG9iamVjdE5hbWU/OiBzdHJpbmdcbiAgcXVlcnk/OiBzdHJpbmdcbiAgcGF0aFN0eWxlPzogYm9vbGVhblxufVxuXG5leHBvcnQgdHlwZSBOb1Jlc3VsdENhbGxiYWNrID0gKGVycm9yOiB1bmtub3duKSA9PiB2b2lkXG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVtb3ZlT3B0aW9ucyB7XG4gIHZlcnNpb25JZD86IHN0cmluZ1xuICBnb3Zlcm5hbmNlQnlwYXNzPzogYm9vbGVhblxuICBmb3JjZURlbGV0ZT86IGJvb2xlYW5cbn1cblxuZXhwb3J0IGNsYXNzIFR5cGVkQ2xpZW50IHtcbiAgcHJvdGVjdGVkIHRyYW5zcG9ydDogVHJhbnNwb3J0XG4gIHByb3RlY3RlZCBob3N0OiBzdHJpbmdcbiAgcHJvdGVjdGVkIHBvcnQ6IG51bWJlclxuICBwcm90ZWN0ZWQgcHJvdG9jb2w6IHN0cmluZ1xuICBwcm90ZWN0ZWQgYWNjZXNzS2V5OiBzdHJpbmdcbiAgcHJvdGVjdGVkIHNlY3JldEtleTogc3RyaW5nXG4gIHByb3RlY3RlZCBzZXNzaW9uVG9rZW4/OiBzdHJpbmdcbiAgcHJvdGVjdGVkIHVzZXJBZ2VudDogc3RyaW5nXG4gIHByb3RlY3RlZCBhbm9ueW1vdXM6IGJvb2xlYW5cbiAgcHJvdGVjdGVkIHBhdGhTdHlsZTogYm9vbGVhblxuICBwcm90ZWN0ZWQgcmVnaW9uTWFwOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG4gIHB1YmxpYyByZWdpb24/OiBzdHJpbmdcbiAgcHJvdGVjdGVkIGNyZWRlbnRpYWxzUHJvdmlkZXI/OiBDcmVkZW50aWFsUHJvdmlkZXJcbiAgcGFydFNpemU6IG51bWJlciA9IDY0ICogMTAyNCAqIDEwMjRcbiAgcHJvdGVjdGVkIG92ZXJSaWRlUGFydFNpemU/OiBib29sZWFuXG5cbiAgcHJvdGVjdGVkIG1heGltdW1QYXJ0U2l6ZSA9IDUgKiAxMDI0ICogMTAyNCAqIDEwMjRcbiAgcHJvdGVjdGVkIG1heE9iamVjdFNpemUgPSA1ICogMTAyNCAqIDEwMjQgKiAxMDI0ICogMTAyNFxuICBwdWJsaWMgZW5hYmxlU0hBMjU2OiBib29sZWFuXG4gIHByb3RlY3RlZCBzM0FjY2VsZXJhdGVFbmRwb2ludD86IHN0cmluZ1xuICBwcm90ZWN0ZWQgcmVxT3B0aW9uczogUmVjb3JkPHN0cmluZywgdW5rbm93bj5cblxuICBwcm90ZWN0ZWQgdHJhbnNwb3J0QWdlbnQ6IGh0dHAuQWdlbnRcbiAgcHJpdmF0ZSByZWFkb25seSBjbGllbnRFeHRlbnNpb25zOiBFeHRlbnNpb25zXG5cbiAgY29uc3RydWN0b3IocGFyYW1zOiBDbGllbnRPcHRpb25zKSB7XG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvciBkZXByZWNhdGVkIHByb3BlcnR5XG4gICAgaWYgKHBhcmFtcy5zZWN1cmUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdcInNlY3VyZVwiIG9wdGlvbiBkZXByZWNhdGVkLCBcInVzZVNTTFwiIHNob3VsZCBiZSB1c2VkIGluc3RlYWQnKVxuICAgIH1cbiAgICAvLyBEZWZhdWx0IHZhbHVlcyBpZiBub3Qgc3BlY2lmaWVkLlxuICAgIGlmIChwYXJhbXMudXNlU1NMID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhcmFtcy51c2VTU0wgPSB0cnVlXG4gICAgfVxuICAgIGlmICghcGFyYW1zLnBvcnQpIHtcbiAgICAgIHBhcmFtcy5wb3J0ID0gMFxuICAgIH1cbiAgICAvLyBWYWxpZGF0ZSBpbnB1dCBwYXJhbXMuXG4gICAgaWYgKCFpc1ZhbGlkRW5kcG9pbnQocGFyYW1zLmVuZFBvaW50KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkRW5kcG9pbnRFcnJvcihgSW52YWxpZCBlbmRQb2ludCA6ICR7cGFyYW1zLmVuZFBvaW50fWApXG4gICAgfVxuICAgIGlmICghaXNWYWxpZFBvcnQocGFyYW1zLnBvcnQpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHBvcnQgOiAke3BhcmFtcy5wb3J0fWApXG4gICAgfVxuICAgIGlmICghaXNCb29sZWFuKHBhcmFtcy51c2VTU0wpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICBgSW52YWxpZCB1c2VTU0wgZmxhZyB0eXBlIDogJHtwYXJhbXMudXNlU1NMfSwgZXhwZWN0ZWQgdG8gYmUgb2YgdHlwZSBcImJvb2xlYW5cImAsXG4gICAgICApXG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgcmVnaW9uIG9ubHkgaWYgaXRzIHNldC5cbiAgICBpZiAocGFyYW1zLnJlZ2lvbikge1xuICAgICAgaWYgKCFpc1N0cmluZyhwYXJhbXMucmVnaW9uKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHJlZ2lvbiA6ICR7cGFyYW1zLnJlZ2lvbn1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGhvc3QgPSBwYXJhbXMuZW5kUG9pbnQudG9Mb3dlckNhc2UoKVxuICAgIGxldCBwb3J0ID0gcGFyYW1zLnBvcnRcbiAgICBsZXQgcHJvdG9jb2w6IHN0cmluZ1xuICAgIGxldCB0cmFuc3BvcnRcbiAgICBsZXQgdHJhbnNwb3J0QWdlbnQ6IGh0dHAuQWdlbnRcbiAgICAvLyBWYWxpZGF0ZSBpZiBjb25maWd1cmF0aW9uIGlzIG5vdCB1c2luZyBTU0xcbiAgICAvLyBmb3IgY29uc3RydWN0aW5nIHJlbGV2YW50IGVuZHBvaW50cy5cbiAgICBpZiAocGFyYW1zLnVzZVNTTCkge1xuICAgICAgLy8gRGVmYXVsdHMgdG8gc2VjdXJlLlxuICAgICAgdHJhbnNwb3J0ID0gaHR0cHNcbiAgICAgIHByb3RvY29sID0gJ2h0dHBzOidcbiAgICAgIHBvcnQgPSBwb3J0IHx8IDQ0M1xuICAgICAgdHJhbnNwb3J0QWdlbnQgPSBodHRwcy5nbG9iYWxBZ2VudFxuICAgIH0gZWxzZSB7XG4gICAgICB0cmFuc3BvcnQgPSBodHRwXG4gICAgICBwcm90b2NvbCA9ICdodHRwOidcbiAgICAgIHBvcnQgPSBwb3J0IHx8IDgwXG4gICAgICB0cmFuc3BvcnRBZ2VudCA9IGh0dHAuZ2xvYmFsQWdlbnRcbiAgICB9XG5cbiAgICAvLyBpZiBjdXN0b20gdHJhbnNwb3J0IGlzIHNldCwgdXNlIGl0LlxuICAgIGlmIChwYXJhbXMudHJhbnNwb3J0KSB7XG4gICAgICBpZiAoIWlzT2JqZWN0KHBhcmFtcy50cmFuc3BvcnQpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgYEludmFsaWQgdHJhbnNwb3J0IHR5cGUgOiAke3BhcmFtcy50cmFuc3BvcnR9LCBleHBlY3RlZCB0byBiZSB0eXBlIFwib2JqZWN0XCJgLFxuICAgICAgICApXG4gICAgICB9XG4gICAgICB0cmFuc3BvcnQgPSBwYXJhbXMudHJhbnNwb3J0XG4gICAgfVxuXG4gICAgLy8gaWYgY3VzdG9tIHRyYW5zcG9ydCBhZ2VudCBpcyBzZXQsIHVzZSBpdC5cbiAgICBpZiAocGFyYW1zLnRyYW5zcG9ydEFnZW50KSB7XG4gICAgICBpZiAoIWlzT2JqZWN0KHBhcmFtcy50cmFuc3BvcnRBZ2VudCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgICBgSW52YWxpZCB0cmFuc3BvcnRBZ2VudCB0eXBlOiAke3BhcmFtcy50cmFuc3BvcnRBZ2VudH0sIGV4cGVjdGVkIHRvIGJlIHR5cGUgXCJvYmplY3RcImAsXG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgdHJhbnNwb3J0QWdlbnQgPSBwYXJhbXMudHJhbnNwb3J0QWdlbnRcbiAgICB9XG5cbiAgICAvLyBVc2VyIEFnZW50IHNob3VsZCBhbHdheXMgZm9sbG93aW5nIHRoZSBiZWxvdyBzdHlsZS5cbiAgICAvLyBQbGVhc2Ugb3BlbiBhbiBpc3N1ZSB0byBkaXNjdXNzIGFueSBuZXcgY2hhbmdlcyBoZXJlLlxuICAgIC8vXG4gICAgLy8gICAgICAgTWluSU8gKE9TOyBBUkNIKSBMSUIvVkVSIEFQUC9WRVJcbiAgICAvL1xuICAgIGNvbnN0IGxpYnJhcnlDb21tZW50cyA9IGAoJHtwcm9jZXNzLnBsYXRmb3JtfTsgJHtwcm9jZXNzLmFyY2h9KWBcbiAgICBjb25zdCBsaWJyYXJ5QWdlbnQgPSBgTWluSU8gJHtsaWJyYXJ5Q29tbWVudHN9IG1pbmlvLWpzLyR7UGFja2FnZS52ZXJzaW9ufWBcbiAgICAvLyBVc2VyIGFnZW50IGJsb2NrIGVuZHMuXG5cbiAgICB0aGlzLnRyYW5zcG9ydCA9IHRyYW5zcG9ydFxuICAgIHRoaXMudHJhbnNwb3J0QWdlbnQgPSB0cmFuc3BvcnRBZ2VudFxuICAgIHRoaXMuaG9zdCA9IGhvc3RcbiAgICB0aGlzLnBvcnQgPSBwb3J0XG4gICAgdGhpcy5wcm90b2NvbCA9IHByb3RvY29sXG4gICAgdGhpcy51c2VyQWdlbnQgPSBgJHtsaWJyYXJ5QWdlbnR9YFxuXG4gICAgLy8gRGVmYXVsdCBwYXRoIHN0eWxlIGlzIHRydWVcbiAgICBpZiAocGFyYW1zLnBhdGhTdHlsZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLnBhdGhTdHlsZSA9IHRydWVcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5wYXRoU3R5bGUgPSBwYXJhbXMucGF0aFN0eWxlXG4gICAgfVxuXG4gICAgdGhpcy5hY2Nlc3NLZXkgPSBwYXJhbXMuYWNjZXNzS2V5ID8/ICcnXG4gICAgdGhpcy5zZWNyZXRLZXkgPSBwYXJhbXMuc2VjcmV0S2V5ID8/ICcnXG4gICAgdGhpcy5zZXNzaW9uVG9rZW4gPSBwYXJhbXMuc2Vzc2lvblRva2VuXG4gICAgdGhpcy5hbm9ueW1vdXMgPSAhdGhpcy5hY2Nlc3NLZXkgfHwgIXRoaXMuc2VjcmV0S2V5XG5cbiAgICBpZiAocGFyYW1zLmNyZWRlbnRpYWxzUHJvdmlkZXIpIHtcbiAgICAgIHRoaXMuY3JlZGVudGlhbHNQcm92aWRlciA9IHBhcmFtcy5jcmVkZW50aWFsc1Byb3ZpZGVyXG4gICAgfVxuXG4gICAgdGhpcy5yZWdpb25NYXAgPSB7fVxuICAgIGlmIChwYXJhbXMucmVnaW9uKSB7XG4gICAgICB0aGlzLnJlZ2lvbiA9IHBhcmFtcy5yZWdpb25cbiAgICB9XG5cbiAgICBpZiAocGFyYW1zLnBhcnRTaXplKSB7XG4gICAgICB0aGlzLnBhcnRTaXplID0gcGFyYW1zLnBhcnRTaXplXG4gICAgICB0aGlzLm92ZXJSaWRlUGFydFNpemUgPSB0cnVlXG4gICAgfVxuICAgIGlmICh0aGlzLnBhcnRTaXplIDwgNSAqIDEwMjQgKiAxMDI0KSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBQYXJ0IHNpemUgc2hvdWxkIGJlIGdyZWF0ZXIgdGhhbiA1TUJgKVxuICAgIH1cbiAgICBpZiAodGhpcy5wYXJ0U2l6ZSA+IDUgKiAxMDI0ICogMTAyNCAqIDEwMjQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYFBhcnQgc2l6ZSBzaG91bGQgYmUgbGVzcyB0aGFuIDVHQmApXG4gICAgfVxuXG4gICAgLy8gU0hBMjU2IGlzIGVuYWJsZWQgb25seSBmb3IgYXV0aGVudGljYXRlZCBodHRwIHJlcXVlc3RzLiBJZiB0aGUgcmVxdWVzdCBpcyBhdXRoZW50aWNhdGVkXG4gICAgLy8gYW5kIHRoZSBjb25uZWN0aW9uIGlzIGh0dHBzIHdlIHVzZSB4LWFtei1jb250ZW50LXNoYTI1Nj1VTlNJR05FRC1QQVlMT0FEXG4gICAgLy8gaGVhZGVyIGZvciBzaWduYXR1cmUgY2FsY3VsYXRpb24uXG4gICAgdGhpcy5lbmFibGVTSEEyNTYgPSAhdGhpcy5hbm9ueW1vdXMgJiYgIXBhcmFtcy51c2VTU0xcblxuICAgIHRoaXMuczNBY2NlbGVyYXRlRW5kcG9pbnQgPSBwYXJhbXMuczNBY2NlbGVyYXRlRW5kcG9pbnQgfHwgdW5kZWZpbmVkXG4gICAgdGhpcy5yZXFPcHRpb25zID0ge31cbiAgICB0aGlzLmNsaWVudEV4dGVuc2lvbnMgPSBuZXcgRXh0ZW5zaW9ucyh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIE1pbmlvIGV4dGVuc2lvbnMgdGhhdCBhcmVuJ3QgbmVjZXNzYXJ5IHByZXNlbnQgZm9yIEFtYXpvbiBTMyBjb21wYXRpYmxlIHN0b3JhZ2Ugc2VydmVyc1xuICAgKi9cbiAgZ2V0IGV4dGVuc2lvbnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuY2xpZW50RXh0ZW5zaW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIEBwYXJhbSBlbmRQb2ludCAtIHZhbGlkIFMzIGFjY2VsZXJhdGlvbiBlbmQgcG9pbnRcbiAgICovXG4gIHNldFMzVHJhbnNmZXJBY2NlbGVyYXRlKGVuZFBvaW50OiBzdHJpbmcpIHtcbiAgICB0aGlzLnMzQWNjZWxlcmF0ZUVuZHBvaW50ID0gZW5kUG9pbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBzdXBwb3J0ZWQgcmVxdWVzdCBvcHRpb25zLlxuICAgKi9cbiAgcHVibGljIHNldFJlcXVlc3RPcHRpb25zKG9wdGlvbnM6IFBpY2s8aHR0cHMuUmVxdWVzdE9wdGlvbnMsICh0eXBlb2YgcmVxdWVzdE9wdGlvblByb3BlcnRpZXMpW251bWJlcl0+KSB7XG4gICAgaWYgKCFpc09iamVjdChvcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxdWVzdCBvcHRpb25zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICB0aGlzLnJlcU9wdGlvbnMgPSBfLnBpY2sob3B0aW9ucywgcmVxdWVzdE9wdGlvblByb3BlcnRpZXMpXG4gIH1cblxuICAvKipcbiAgICogIFRoaXMgaXMgczMgU3BlY2lmaWMgYW5kIGRvZXMgbm90IGhvbGQgdmFsaWRpdHkgaW4gYW55IG90aGVyIE9iamVjdCBzdG9yYWdlLlxuICAgKi9cbiAgcHJpdmF0ZSBnZXRBY2NlbGVyYXRlRW5kUG9pbnRJZlNldChidWNrZXROYW1lPzogc3RyaW5nLCBvYmplY3ROYW1lPzogc3RyaW5nKSB7XG4gICAgaWYgKCFpc0VtcHR5KHRoaXMuczNBY2NlbGVyYXRlRW5kcG9pbnQpICYmICFpc0VtcHR5KGJ1Y2tldE5hbWUpICYmICFpc0VtcHR5KG9iamVjdE5hbWUpKSB7XG4gICAgICAvLyBodHRwOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9BbWF6b25TMy9sYXRlc3QvZGV2L3RyYW5zZmVyLWFjY2VsZXJhdGlvbi5odG1sXG4gICAgICAvLyBEaXNhYmxlIHRyYW5zZmVyIGFjY2VsZXJhdGlvbiBmb3Igbm9uLWNvbXBsaWFudCBidWNrZXQgbmFtZXMuXG4gICAgICBpZiAoYnVja2V0TmFtZS5pbmNsdWRlcygnLicpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVHJhbnNmZXIgQWNjZWxlcmF0aW9uIGlzIG5vdCBzdXBwb3J0ZWQgZm9yIG5vbiBjb21wbGlhbnQgYnVja2V0OiR7YnVja2V0TmFtZX1gKVxuICAgICAgfVxuICAgICAgLy8gSWYgdHJhbnNmZXIgYWNjZWxlcmF0aW9uIGlzIHJlcXVlc3RlZCBzZXQgbmV3IGhvc3QuXG4gICAgICAvLyBGb3IgbW9yZSBkZXRhaWxzIGFib3V0IGVuYWJsaW5nIHRyYW5zZmVyIGFjY2VsZXJhdGlvbiByZWFkIGhlcmUuXG4gICAgICAvLyBodHRwOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9BbWF6b25TMy9sYXRlc3QvZGV2L3RyYW5zZmVyLWFjY2VsZXJhdGlvbi5odG1sXG4gICAgICByZXR1cm4gdGhpcy5zM0FjY2VsZXJhdGVFbmRwb2ludFxuICAgIH1cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiByZXR1cm5zIG9wdGlvbnMgb2JqZWN0IHRoYXQgY2FuIGJlIHVzZWQgd2l0aCBodHRwLnJlcXVlc3QoKVxuICAgKiBUYWtlcyBjYXJlIG9mIGNvbnN0cnVjdGluZyB2aXJ0dWFsLWhvc3Qtc3R5bGUgb3IgcGF0aC1zdHlsZSBob3N0bmFtZVxuICAgKi9cbiAgcHJvdGVjdGVkIGdldFJlcXVlc3RPcHRpb25zKFxuICAgIG9wdHM6IFJlcXVlc3RPcHRpb24gJiB7IHJlZ2lvbjogc3RyaW5nIH0sXG4gICk6IElSZXF1ZXN0ICYgeyBob3N0OiBzdHJpbmc7IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfSB7XG4gICAgY29uc3QgbWV0aG9kID0gb3B0cy5tZXRob2RcbiAgICBjb25zdCByZWdpb24gPSBvcHRzLnJlZ2lvblxuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBvcHRzLmJ1Y2tldE5hbWVcbiAgICBsZXQgb2JqZWN0TmFtZSA9IG9wdHMub2JqZWN0TmFtZVxuICAgIGNvbnN0IGhlYWRlcnMgPSBvcHRzLmhlYWRlcnNcbiAgICBjb25zdCBxdWVyeSA9IG9wdHMucXVlcnlcblxuICAgIGxldCByZXFPcHRpb25zID0ge1xuICAgICAgbWV0aG9kLFxuICAgICAgaGVhZGVyczoge30gYXMgUmVxdWVzdEhlYWRlcnMsXG4gICAgICBwcm90b2NvbDogdGhpcy5wcm90b2NvbCxcbiAgICAgIC8vIElmIGN1c3RvbSB0cmFuc3BvcnRBZ2VudCB3YXMgc3VwcGxpZWQgZWFybGllciwgd2UnbGwgaW5qZWN0IGl0IGhlcmVcbiAgICAgIGFnZW50OiB0aGlzLnRyYW5zcG9ydEFnZW50LFxuICAgIH1cblxuICAgIC8vIFZlcmlmeSBpZiB2aXJ0dWFsIGhvc3Qgc3VwcG9ydGVkLlxuICAgIGxldCB2aXJ0dWFsSG9zdFN0eWxlXG4gICAgaWYgKGJ1Y2tldE5hbWUpIHtcbiAgICAgIHZpcnR1YWxIb3N0U3R5bGUgPSBpc1ZpcnR1YWxIb3N0U3R5bGUodGhpcy5ob3N0LCB0aGlzLnByb3RvY29sLCBidWNrZXROYW1lLCB0aGlzLnBhdGhTdHlsZSlcbiAgICB9XG5cbiAgICBsZXQgcGF0aCA9ICcvJ1xuICAgIGxldCBob3N0ID0gdGhpcy5ob3N0XG5cbiAgICBsZXQgcG9ydDogdW5kZWZpbmVkIHwgbnVtYmVyXG4gICAgaWYgKHRoaXMucG9ydCkge1xuICAgICAgcG9ydCA9IHRoaXMucG9ydFxuICAgIH1cblxuICAgIGlmIChvYmplY3ROYW1lKSB7XG4gICAgICBvYmplY3ROYW1lID0gdXJpUmVzb3VyY2VFc2NhcGUob2JqZWN0TmFtZSlcbiAgICB9XG5cbiAgICAvLyBGb3IgQW1hem9uIFMzIGVuZHBvaW50LCBnZXQgZW5kcG9pbnQgYmFzZWQgb24gcmVnaW9uLlxuICAgIGlmIChpc0FtYXpvbkVuZHBvaW50KGhvc3QpKSB7XG4gICAgICBjb25zdCBhY2NlbGVyYXRlRW5kUG9pbnQgPSB0aGlzLmdldEFjY2VsZXJhdGVFbmRQb2ludElmU2V0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUpXG4gICAgICBpZiAoYWNjZWxlcmF0ZUVuZFBvaW50KSB7XG4gICAgICAgIGhvc3QgPSBgJHthY2NlbGVyYXRlRW5kUG9pbnR9YFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaG9zdCA9IGdldFMzRW5kcG9pbnQocmVnaW9uKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh2aXJ0dWFsSG9zdFN0eWxlICYmICFvcHRzLnBhdGhTdHlsZSkge1xuICAgICAgLy8gRm9yIGFsbCBob3N0cyB3aGljaCBzdXBwb3J0IHZpcnR1YWwgaG9zdCBzdHlsZSwgYGJ1Y2tldE5hbWVgXG4gICAgICAvLyBpcyBwYXJ0IG9mIHRoZSBob3N0bmFtZSBpbiB0aGUgZm9sbG93aW5nIGZvcm1hdDpcbiAgICAgIC8vXG4gICAgICAvLyAgdmFyIGhvc3QgPSAnYnVja2V0TmFtZS5leGFtcGxlLmNvbSdcbiAgICAgIC8vXG4gICAgICBpZiAoYnVja2V0TmFtZSkge1xuICAgICAgICBob3N0ID0gYCR7YnVja2V0TmFtZX0uJHtob3N0fWBcbiAgICAgIH1cbiAgICAgIGlmIChvYmplY3ROYW1lKSB7XG4gICAgICAgIHBhdGggPSBgLyR7b2JqZWN0TmFtZX1gXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZvciBhbGwgUzMgY29tcGF0aWJsZSBzdG9yYWdlIHNlcnZpY2VzIHdlIHdpbGwgZmFsbGJhY2sgdG9cbiAgICAgIC8vIHBhdGggc3R5bGUgcmVxdWVzdHMsIHdoZXJlIGBidWNrZXROYW1lYCBpcyBwYXJ0IG9mIHRoZSBVUklcbiAgICAgIC8vIHBhdGguXG4gICAgICBpZiAoYnVja2V0TmFtZSkge1xuICAgICAgICBwYXRoID0gYC8ke2J1Y2tldE5hbWV9YFxuICAgICAgfVxuICAgICAgaWYgKG9iamVjdE5hbWUpIHtcbiAgICAgICAgcGF0aCA9IGAvJHtidWNrZXROYW1lfS8ke29iamVjdE5hbWV9YFxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChxdWVyeSkge1xuICAgICAgcGF0aCArPSBgPyR7cXVlcnl9YFxuICAgIH1cbiAgICByZXFPcHRpb25zLmhlYWRlcnMuaG9zdCA9IGhvc3RcbiAgICBpZiAoKHJlcU9wdGlvbnMucHJvdG9jb2wgPT09ICdodHRwOicgJiYgcG9ydCAhPT0gODApIHx8IChyZXFPcHRpb25zLnByb3RvY29sID09PSAnaHR0cHM6JyAmJiBwb3J0ICE9PSA0NDMpKSB7XG4gICAgICByZXFPcHRpb25zLmhlYWRlcnMuaG9zdCA9IGAke2hvc3R9OiR7cG9ydH1gXG4gICAgfVxuICAgIHJlcU9wdGlvbnMuaGVhZGVyc1sndXNlci1hZ2VudCddID0gdGhpcy51c2VyQWdlbnRcbiAgICBpZiAoaGVhZGVycykge1xuICAgICAgLy8gaGF2ZSBhbGwgaGVhZGVyIGtleXMgaW4gbG93ZXIgY2FzZSAtIHRvIG1ha2Ugc2lnbmluZyBlYXN5XG4gICAgICBmb3IgKGNvbnN0IFtrLCB2XSBvZiBPYmplY3QuZW50cmllcyhoZWFkZXJzKSkge1xuICAgICAgICByZXFPcHRpb25zLmhlYWRlcnNbay50b0xvd2VyQ2FzZSgpXSA9IHZcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBVc2UgYW55IHJlcXVlc3Qgb3B0aW9uIHNwZWNpZmllZCBpbiBtaW5pb0NsaWVudC5zZXRSZXF1ZXN0T3B0aW9ucygpXG4gICAgcmVxT3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMucmVxT3B0aW9ucywgcmVxT3B0aW9ucylcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5yZXFPcHRpb25zLFxuICAgICAgaGVhZGVyczogXy5tYXBWYWx1ZXMoXy5waWNrQnkocmVxT3B0aW9ucy5oZWFkZXJzLCBpc0RlZmluZWQpLCAodikgPT4gdi50b1N0cmluZygpKSxcbiAgICAgIGhvc3QsXG4gICAgICBwb3J0LFxuICAgICAgcGF0aCxcbiAgICB9IHNhdGlzZmllcyBodHRwcy5SZXF1ZXN0T3B0aW9uc1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHNldENyZWRlbnRpYWxzUHJvdmlkZXIoY3JlZGVudGlhbHNQcm92aWRlcjogQ3JlZGVudGlhbFByb3ZpZGVyKSB7XG4gICAgaWYgKCEoY3JlZGVudGlhbHNQcm92aWRlciBpbnN0YW5jZW9mIENyZWRlbnRpYWxQcm92aWRlcikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5hYmxlIHRvIGdldCBjcmVkZW50aWFscy4gRXhwZWN0ZWQgaW5zdGFuY2Ugb2YgQ3JlZGVudGlhbFByb3ZpZGVyJylcbiAgICB9XG4gICAgdGhpcy5jcmVkZW50aWFsc1Byb3ZpZGVyID0gY3JlZGVudGlhbHNQcm92aWRlclxuICAgIGF3YWl0IHRoaXMuY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjaGVja0FuZFJlZnJlc2hDcmVkcygpIHtcbiAgICBpZiAodGhpcy5jcmVkZW50aWFsc1Byb3ZpZGVyKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBjcmVkZW50aWFsc0NvbmYgPSBhd2FpdCB0aGlzLmNyZWRlbnRpYWxzUHJvdmlkZXIuZ2V0Q3JlZGVudGlhbHMoKVxuICAgICAgICB0aGlzLmFjY2Vzc0tleSA9IGNyZWRlbnRpYWxzQ29uZi5nZXRBY2Nlc3NLZXkoKVxuICAgICAgICB0aGlzLnNlY3JldEtleSA9IGNyZWRlbnRpYWxzQ29uZi5nZXRTZWNyZXRLZXkoKVxuICAgICAgICB0aGlzLnNlc3Npb25Ub2tlbiA9IGNyZWRlbnRpYWxzQ29uZi5nZXRTZXNzaW9uVG9rZW4oKVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBnZXQgY3JlZGVudGlhbHM6ICR7ZX1gLCB7IGNhdXNlOiBlIH0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBsb2dTdHJlYW0/OiBzdHJlYW0uV3JpdGFibGVcblxuICAvKipcbiAgICogbG9nIHRoZSByZXF1ZXN0LCByZXNwb25zZSwgZXJyb3JcbiAgICovXG4gIHByaXZhdGUgbG9nSFRUUChyZXFPcHRpb25zOiBJUmVxdWVzdCwgcmVzcG9uc2U6IGh0dHAuSW5jb21pbmdNZXNzYWdlIHwgbnVsbCwgZXJyPzogdW5rbm93bikge1xuICAgIC8vIGlmIG5vIGxvZ1N0cmVhbSBhdmFpbGFibGUgcmV0dXJuLlxuICAgIGlmICghdGhpcy5sb2dTdHJlYW0pIHtcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHJlcU9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXFPcHRpb25zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAocmVzcG9uc2UgJiYgIWlzUmVhZGFibGVTdHJlYW0ocmVzcG9uc2UpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXNwb25zZSBzaG91bGQgYmUgb2YgdHlwZSBcIlN0cmVhbVwiJylcbiAgICB9XG4gICAgaWYgKGVyciAmJiAhKGVyciBpbnN0YW5jZW9mIEVycm9yKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZXJyIHNob3VsZCBiZSBvZiB0eXBlIFwiRXJyb3JcIicpXG4gICAgfVxuICAgIGNvbnN0IGxvZ1N0cmVhbSA9IHRoaXMubG9nU3RyZWFtXG4gICAgY29uc3QgbG9nSGVhZGVycyA9IChoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycykgPT4ge1xuICAgICAgT2JqZWN0LmVudHJpZXMoaGVhZGVycykuZm9yRWFjaCgoW2ssIHZdKSA9PiB7XG4gICAgICAgIGlmIChrID09ICdhdXRob3JpemF0aW9uJykge1xuICAgICAgICAgIGlmIChpc1N0cmluZyh2KSkge1xuICAgICAgICAgICAgY29uc3QgcmVkYWN0b3IgPSBuZXcgUmVnRXhwKCdTaWduYXR1cmU9KFswLTlhLWZdKyknKVxuICAgICAgICAgICAgdiA9IHYucmVwbGFjZShyZWRhY3RvciwgJ1NpZ25hdHVyZT0qKlJFREFDVEVEKionKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBsb2dTdHJlYW0ud3JpdGUoYCR7a306ICR7dn1cXG5gKVxuICAgICAgfSlcbiAgICAgIGxvZ1N0cmVhbS53cml0ZSgnXFxuJylcbiAgICB9XG4gICAgbG9nU3RyZWFtLndyaXRlKGBSRVFVRVNUOiAke3JlcU9wdGlvbnMubWV0aG9kfSAke3JlcU9wdGlvbnMucGF0aH1cXG5gKVxuICAgIGxvZ0hlYWRlcnMocmVxT3B0aW9ucy5oZWFkZXJzKVxuICAgIGlmIChyZXNwb25zZSkge1xuICAgICAgdGhpcy5sb2dTdHJlYW0ud3JpdGUoYFJFU1BPTlNFOiAke3Jlc3BvbnNlLnN0YXR1c0NvZGV9XFxuYClcbiAgICAgIGxvZ0hlYWRlcnMocmVzcG9uc2UuaGVhZGVycyBhcyBSZXF1ZXN0SGVhZGVycylcbiAgICB9XG4gICAgaWYgKGVycikge1xuICAgICAgbG9nU3RyZWFtLndyaXRlKCdFUlJPUiBCT0RZOlxcbicpXG4gICAgICBjb25zdCBlcnJKU09OID0gSlNPTi5zdHJpbmdpZnkoZXJyLCBudWxsLCAnXFx0JylcbiAgICAgIGxvZ1N0cmVhbS53cml0ZShgJHtlcnJKU09OfVxcbmApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuYWJsZSB0cmFjaW5nXG4gICAqL1xuICBwdWJsaWMgdHJhY2VPbihzdHJlYW0/OiBzdHJlYW0uV3JpdGFibGUpIHtcbiAgICBpZiAoIXN0cmVhbSkge1xuICAgICAgc3RyZWFtID0gcHJvY2Vzcy5zdGRvdXRcbiAgICB9XG4gICAgdGhpcy5sb2dTdHJlYW0gPSBzdHJlYW1cbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNhYmxlIHRyYWNpbmdcbiAgICovXG4gIHB1YmxpYyB0cmFjZU9mZigpIHtcbiAgICB0aGlzLmxvZ1N0cmVhbSA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIG1ha2VSZXF1ZXN0IGlzIHRoZSBwcmltaXRpdmUgdXNlZCBieSB0aGUgYXBpcyBmb3IgbWFraW5nIFMzIHJlcXVlc3RzLlxuICAgKiBwYXlsb2FkIGNhbiBiZSBlbXB0eSBzdHJpbmcgaW4gY2FzZSBvZiBubyBwYXlsb2FkLlxuICAgKiBzdGF0dXNDb2RlIGlzIHRoZSBleHBlY3RlZCBzdGF0dXNDb2RlLiBJZiByZXNwb25zZS5zdGF0dXNDb2RlIGRvZXMgbm90IG1hdGNoXG4gICAqIHdlIHBhcnNlIHRoZSBYTUwgZXJyb3IgYW5kIGNhbGwgdGhlIGNhbGxiYWNrIHdpdGggdGhlIGVycm9yIG1lc3NhZ2UuXG4gICAqXG4gICAqIEEgdmFsaWQgcmVnaW9uIGlzIHBhc3NlZCBieSB0aGUgY2FsbHMgLSBsaXN0QnVja2V0cywgbWFrZUJ1Y2tldCBhbmQgZ2V0QnVja2V0UmVnaW9uLlxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIGFzeW5jIG1ha2VSZXF1ZXN0QXN5bmMoXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBwYXlsb2FkOiBCaW5hcnkgPSAnJyxcbiAgICBleHBlY3RlZENvZGVzOiBudW1iZXJbXSA9IFsyMDBdLFxuICAgIHJlZ2lvbiA9ICcnLFxuICApOiBQcm9taXNlPGh0dHAuSW5jb21pbmdNZXNzYWdlPiB7XG4gICAgaWYgKCFpc09iamVjdChvcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwYXlsb2FkKSAmJiAhaXNPYmplY3QocGF5bG9hZCkpIHtcbiAgICAgIC8vIEJ1ZmZlciBpcyBvZiB0eXBlICdvYmplY3QnXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwYXlsb2FkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCIgb3IgXCJCdWZmZXJcIicpXG4gICAgfVxuICAgIGV4cGVjdGVkQ29kZXMuZm9yRWFjaCgoc3RhdHVzQ29kZSkgPT4ge1xuICAgICAgaWYgKCFpc051bWJlcihzdGF0dXNDb2RlKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdGF0dXNDb2RlIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgICAgfVxuICAgIH0pXG4gICAgaWYgKCFpc1N0cmluZyhyZWdpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWdpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghb3B0aW9ucy5oZWFkZXJzKSB7XG4gICAgICBvcHRpb25zLmhlYWRlcnMgPSB7fVxuICAgIH1cbiAgICBpZiAob3B0aW9ucy5tZXRob2QgPT09ICdQT1NUJyB8fCBvcHRpb25zLm1ldGhvZCA9PT0gJ1BVVCcgfHwgb3B0aW9ucy5tZXRob2QgPT09ICdERUxFVEUnKSB7XG4gICAgICBvcHRpb25zLmhlYWRlcnNbJ2NvbnRlbnQtbGVuZ3RoJ10gPSBwYXlsb2FkLmxlbmd0aC50b1N0cmluZygpXG4gICAgfVxuICAgIGNvbnN0IHNoYTI1NnN1bSA9IHRoaXMuZW5hYmxlU0hBMjU2ID8gdG9TaGEyNTYocGF5bG9hZCkgOiAnJ1xuICAgIHJldHVybiB0aGlzLm1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMob3B0aW9ucywgcGF5bG9hZCwgc2hhMjU2c3VtLCBleHBlY3RlZENvZGVzLCByZWdpb24pXG4gIH1cblxuICAvKipcbiAgICogbmV3IHJlcXVlc3Qgd2l0aCBwcm9taXNlXG4gICAqXG4gICAqIE5vIG5lZWQgdG8gZHJhaW4gcmVzcG9uc2UsIHJlc3BvbnNlIGJvZHkgaXMgbm90IHZhbGlkXG4gICAqL1xuICBhc3luYyBtYWtlUmVxdWVzdEFzeW5jT21pdChcbiAgICBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uLFxuICAgIHBheWxvYWQ6IEJpbmFyeSA9ICcnLFxuICAgIHN0YXR1c0NvZGVzOiBudW1iZXJbXSA9IFsyMDBdLFxuICAgIHJlZ2lvbiA9ICcnLFxuICApOiBQcm9taXNlPE9taXQ8aHR0cC5JbmNvbWluZ01lc3NhZ2UsICdvbic+PiB7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKG9wdGlvbnMsIHBheWxvYWQsIHN0YXR1c0NvZGVzLCByZWdpb24pXG4gICAgYXdhaXQgZHJhaW5SZXNwb25zZShyZXMpXG4gICAgcmV0dXJuIHJlc1xuICB9XG5cbiAgLyoqXG4gICAqIG1ha2VSZXF1ZXN0U3RyZWFtIHdpbGwgYmUgdXNlZCBkaXJlY3RseSBpbnN0ZWFkIG9mIG1ha2VSZXF1ZXN0IGluIGNhc2UgdGhlIHBheWxvYWRcbiAgICogaXMgYXZhaWxhYmxlIGFzIGEgc3RyZWFtLiBmb3IgZXguIHB1dE9iamVjdFxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIGFzeW5jIG1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMoXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBib2R5OiBzdHJlYW0uUmVhZGFibGUgfCBCaW5hcnksXG4gICAgc2hhMjU2c3VtOiBzdHJpbmcsXG4gICAgc3RhdHVzQ29kZXM6IG51bWJlcltdLFxuICAgIHJlZ2lvbjogc3RyaW5nLFxuICApOiBQcm9taXNlPGh0dHAuSW5jb21pbmdNZXNzYWdlPiB7XG4gICAgaWYgKCFpc09iamVjdChvcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKCEoQnVmZmVyLmlzQnVmZmVyKGJvZHkpIHx8IHR5cGVvZiBib2R5ID09PSAnc3RyaW5nJyB8fCBpc1JlYWRhYmxlU3RyZWFtKGJvZHkpKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgYHN0cmVhbSBzaG91bGQgYmUgYSBCdWZmZXIsIHN0cmluZyBvciByZWFkYWJsZSBTdHJlYW0sIGdvdCAke3R5cGVvZiBib2R5fSBpbnN0ZWFkYCxcbiAgICAgIClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhzaGEyNTZzdW0pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzaGEyNTZzdW0gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIHN0YXR1c0NvZGVzLmZvckVhY2goKHN0YXR1c0NvZGUpID0+IHtcbiAgICAgIGlmICghaXNOdW1iZXIoc3RhdHVzQ29kZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc3RhdHVzQ29kZSBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICAgIH1cbiAgICB9KVxuICAgIGlmICghaXNTdHJpbmcocmVnaW9uKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVnaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICAvLyBzaGEyNTZzdW0gd2lsbCBiZSBlbXB0eSBmb3IgYW5vbnltb3VzIG9yIGh0dHBzIHJlcXVlc3RzXG4gICAgaWYgKCF0aGlzLmVuYWJsZVNIQTI1NiAmJiBzaGEyNTZzdW0ubGVuZ3RoICE9PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBzaGEyNTZzdW0gZXhwZWN0ZWQgdG8gYmUgZW1wdHkgZm9yIGFub255bW91cyBvciBodHRwcyByZXF1ZXN0c2ApXG4gICAgfVxuICAgIC8vIHNoYTI1NnN1bSBzaG91bGQgYmUgdmFsaWQgZm9yIG5vbi1hbm9ueW1vdXMgaHR0cCByZXF1ZXN0cy5cbiAgICBpZiAodGhpcy5lbmFibGVTSEEyNTYgJiYgc2hhMjU2c3VtLmxlbmd0aCAhPT0gNjQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgc2hhMjU2c3VtIDogJHtzaGEyNTZzdW19YClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmNoZWNrQW5kUmVmcmVzaENyZWRzKClcblxuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgcmVnaW9uID0gcmVnaW9uIHx8IChhd2FpdCB0aGlzLmdldEJ1Y2tldFJlZ2lvbkFzeW5jKG9wdGlvbnMuYnVja2V0TmFtZSEpKVxuXG4gICAgY29uc3QgcmVxT3B0aW9ucyA9IHRoaXMuZ2V0UmVxdWVzdE9wdGlvbnMoeyAuLi5vcHRpb25zLCByZWdpb24gfSlcbiAgICBpZiAoIXRoaXMuYW5vbnltb3VzKSB7XG4gICAgICAvLyBGb3Igbm9uLWFub255bW91cyBodHRwcyByZXF1ZXN0cyBzaGEyNTZzdW0gaXMgJ1VOU0lHTkVELVBBWUxPQUQnIGZvciBzaWduYXR1cmUgY2FsY3VsYXRpb24uXG4gICAgICBpZiAoIXRoaXMuZW5hYmxlU0hBMjU2KSB7XG4gICAgICAgIHNoYTI1NnN1bSA9ICdVTlNJR05FRC1QQVlMT0FEJ1xuICAgICAgfVxuICAgICAgY29uc3QgZGF0ZSA9IG5ldyBEYXRlKClcbiAgICAgIHJlcU9wdGlvbnMuaGVhZGVyc1sneC1hbXotZGF0ZSddID0gbWFrZURhdGVMb25nKGRhdGUpXG4gICAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3gtYW16LWNvbnRlbnQtc2hhMjU2J10gPSBzaGEyNTZzdW1cbiAgICAgIGlmICh0aGlzLnNlc3Npb25Ub2tlbikge1xuICAgICAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3gtYW16LXNlY3VyaXR5LXRva2VuJ10gPSB0aGlzLnNlc3Npb25Ub2tlblxuICAgICAgfVxuICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzLmF1dGhvcml6YXRpb24gPSBzaWduVjQocmVxT3B0aW9ucywgdGhpcy5hY2Nlc3NLZXksIHRoaXMuc2VjcmV0S2V5LCByZWdpb24sIGRhdGUsIHNoYTI1NnN1bSlcbiAgICB9XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHJlcXVlc3QodGhpcy50cmFuc3BvcnQsIHJlcU9wdGlvbnMsIGJvZHkpXG4gICAgaWYgKCFyZXNwb25zZS5zdGF0dXNDb2RlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJCVUc6IHJlc3BvbnNlIGRvZXNuJ3QgaGF2ZSBhIHN0YXR1c0NvZGVcIilcbiAgICB9XG5cbiAgICBpZiAoIXN0YXR1c0NvZGVzLmluY2x1ZGVzKHJlc3BvbnNlLnN0YXR1c0NvZGUpKSB7XG4gICAgICAvLyBGb3IgYW4gaW5jb3JyZWN0IHJlZ2lvbiwgUzMgc2VydmVyIGFsd2F5cyBzZW5kcyBiYWNrIDQwMC5cbiAgICAgIC8vIEJ1dCB3ZSB3aWxsIGRvIGNhY2hlIGludmFsaWRhdGlvbiBmb3IgYWxsIGVycm9ycyBzbyB0aGF0LFxuICAgICAgLy8gaW4gZnV0dXJlLCBpZiBBV1MgUzMgZGVjaWRlcyB0byBzZW5kIGEgZGlmZmVyZW50IHN0YXR1cyBjb2RlIG9yXG4gICAgICAvLyBYTUwgZXJyb3IgY29kZSB3ZSB3aWxsIHN0aWxsIHdvcmsgZmluZS5cbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgICBkZWxldGUgdGhpcy5yZWdpb25NYXBbb3B0aW9ucy5idWNrZXROYW1lIV1cblxuICAgICAgY29uc3QgZXJyID0gYXdhaXQgeG1sUGFyc2Vycy5wYXJzZVJlc3BvbnNlRXJyb3IocmVzcG9uc2UpXG4gICAgICB0aGlzLmxvZ0hUVFAocmVxT3B0aW9ucywgcmVzcG9uc2UsIGVycilcbiAgICAgIHRocm93IGVyclxuICAgIH1cblxuICAgIHRoaXMubG9nSFRUUChyZXFPcHRpb25zLCByZXNwb25zZSlcblxuICAgIHJldHVybiByZXNwb25zZVxuICB9XG5cbiAgLyoqXG4gICAqIGdldHMgdGhlIHJlZ2lvbiBvZiB0aGUgYnVja2V0XG4gICAqXG4gICAqIEBwYXJhbSBidWNrZXROYW1lXG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGdldEJ1Y2tldFJlZ2lvbkFzeW5jKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lIDogJHtidWNrZXROYW1lfWApXG4gICAgfVxuXG4gICAgLy8gUmVnaW9uIGlzIHNldCB3aXRoIGNvbnN0cnVjdG9yLCByZXR1cm4gdGhlIHJlZ2lvbiByaWdodCBoZXJlLlxuICAgIGlmICh0aGlzLnJlZ2lvbikge1xuICAgICAgcmV0dXJuIHRoaXMucmVnaW9uXG4gICAgfVxuXG4gICAgY29uc3QgY2FjaGVkID0gdGhpcy5yZWdpb25NYXBbYnVja2V0TmFtZV1cbiAgICBpZiAoY2FjaGVkKSB7XG4gICAgICByZXR1cm4gY2FjaGVkXG4gICAgfVxuXG4gICAgY29uc3QgZXh0cmFjdFJlZ2lvbkFzeW5jID0gYXN5bmMgKHJlc3BvbnNlOiBodHRwLkluY29taW5nTWVzc2FnZSkgPT4ge1xuICAgICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXNwb25zZSlcbiAgICAgIGNvbnN0IHJlZ2lvbiA9IHhtbFBhcnNlcnMucGFyc2VCdWNrZXRSZWdpb24oYm9keSkgfHwgREVGQVVMVF9SRUdJT05cbiAgICAgIHRoaXMucmVnaW9uTWFwW2J1Y2tldE5hbWVdID0gcmVnaW9uXG4gICAgICByZXR1cm4gcmVnaW9uXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICdsb2NhdGlvbidcbiAgICAvLyBgZ2V0QnVja2V0TG9jYXRpb25gIGJlaGF2ZXMgZGlmZmVyZW50bHkgaW4gZm9sbG93aW5nIHdheXMgZm9yXG4gICAgLy8gZGlmZmVyZW50IGVudmlyb25tZW50cy5cbiAgICAvL1xuICAgIC8vIC0gRm9yIG5vZGVqcyBlbnYgd2UgZGVmYXVsdCB0byBwYXRoIHN0eWxlIHJlcXVlc3RzLlxuICAgIC8vIC0gRm9yIGJyb3dzZXIgZW52IHBhdGggc3R5bGUgcmVxdWVzdHMgb24gYnVja2V0cyB5aWVsZHMgQ09SU1xuICAgIC8vICAgZXJyb3IuIFRvIGNpcmN1bXZlbnQgdGhpcyBwcm9ibGVtIHdlIG1ha2UgYSB2aXJ0dWFsIGhvc3RcbiAgICAvLyAgIHN0eWxlIHJlcXVlc3Qgc2lnbmVkIHdpdGggJ3VzLWVhc3QtMScuIFRoaXMgcmVxdWVzdCBmYWlsc1xuICAgIC8vICAgd2l0aCBhbiBlcnJvciAnQXV0aG9yaXphdGlvbkhlYWRlck1hbGZvcm1lZCcsIGFkZGl0aW9uYWxseVxuICAgIC8vICAgdGhlIGVycm9yIFhNTCBhbHNvIHByb3ZpZGVzIFJlZ2lvbiBvZiB0aGUgYnVja2V0LiBUbyB2YWxpZGF0ZVxuICAgIC8vICAgdGhpcyByZWdpb24gaXMgcHJvcGVyIHdlIHJldHJ5IHRoZSBzYW1lIHJlcXVlc3Qgd2l0aCB0aGUgbmV3bHlcbiAgICAvLyAgIG9idGFpbmVkIHJlZ2lvbi5cbiAgICBjb25zdCBwYXRoU3R5bGUgPSB0aGlzLnBhdGhTdHlsZSAmJiAhaXNCcm93c2VyXG4gICAgbGV0IHJlZ2lvbjogc3RyaW5nXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIHBhdGhTdHlsZSB9LCAnJywgWzIwMF0sIERFRkFVTFRfUkVHSU9OKVxuICAgICAgcmV0dXJuIGV4dHJhY3RSZWdpb25Bc3luYyhyZXMpXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgaWYgKCEoZS5uYW1lID09PSAnQXV0aG9yaXphdGlvbkhlYWRlck1hbGZvcm1lZCcpKSB7XG4gICAgICAgIHRocm93IGVcbiAgICAgIH1cbiAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3Igd2Ugc2V0IGV4dHJhIHByb3BlcnRpZXMgb24gZXJyb3Igb2JqZWN0XG4gICAgICByZWdpb24gPSBlLlJlZ2lvbiBhcyBzdHJpbmdcbiAgICAgIGlmICghcmVnaW9uKSB7XG4gICAgICAgIHRocm93IGVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBwYXRoU3R5bGUgfSwgJycsIFsyMDBdLCByZWdpb24pXG4gICAgcmV0dXJuIGF3YWl0IGV4dHJhY3RSZWdpb25Bc3luYyhyZXMpXG4gIH1cblxuICAvKipcbiAgICogbWFrZVJlcXVlc3QgaXMgdGhlIHByaW1pdGl2ZSB1c2VkIGJ5IHRoZSBhcGlzIGZvciBtYWtpbmcgUzMgcmVxdWVzdHMuXG4gICAqIHBheWxvYWQgY2FuIGJlIGVtcHR5IHN0cmluZyBpbiBjYXNlIG9mIG5vIHBheWxvYWQuXG4gICAqIHN0YXR1c0NvZGUgaXMgdGhlIGV4cGVjdGVkIHN0YXR1c0NvZGUuIElmIHJlc3BvbnNlLnN0YXR1c0NvZGUgZG9lcyBub3QgbWF0Y2hcbiAgICogd2UgcGFyc2UgdGhlIFhNTCBlcnJvciBhbmQgY2FsbCB0aGUgY2FsbGJhY2sgd2l0aCB0aGUgZXJyb3IgbWVzc2FnZS5cbiAgICogQSB2YWxpZCByZWdpb24gaXMgcGFzc2VkIGJ5IHRoZSBjYWxscyAtIGxpc3RCdWNrZXRzLCBtYWtlQnVja2V0IGFuZFxuICAgKiBnZXRCdWNrZXRSZWdpb24uXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBgbWFrZVJlcXVlc3RBc3luY2AgaW5zdGVhZFxuICAgKi9cbiAgbWFrZVJlcXVlc3QoXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBwYXlsb2FkOiBCaW5hcnkgPSAnJyxcbiAgICBleHBlY3RlZENvZGVzOiBudW1iZXJbXSA9IFsyMDBdLFxuICAgIHJlZ2lvbiA9ICcnLFxuICAgIHJldHVyblJlc3BvbnNlOiBib29sZWFuLFxuICAgIGNiOiAoY2I6IHVua25vd24sIHJlc3VsdDogaHR0cC5JbmNvbWluZ01lc3NhZ2UpID0+IHZvaWQsXG4gICkge1xuICAgIGxldCBwcm9tOiBQcm9taXNlPGh0dHAuSW5jb21pbmdNZXNzYWdlPlxuICAgIGlmIChyZXR1cm5SZXNwb25zZSkge1xuICAgICAgcHJvbSA9IHRoaXMubWFrZVJlcXVlc3RBc3luYyhvcHRpb25zLCBwYXlsb2FkLCBleHBlY3RlZENvZGVzLCByZWdpb24pXG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgY29tcGF0aWJsZSBmb3Igb2xkIGJlaGF2aW91clxuICAgICAgcHJvbSA9IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQob3B0aW9ucywgcGF5bG9hZCwgZXhwZWN0ZWRDb2RlcywgcmVnaW9uKVxuICAgIH1cblxuICAgIHByb20udGhlbihcbiAgICAgIChyZXN1bHQpID0+IGNiKG51bGwsIHJlc3VsdCksXG4gICAgICAoZXJyKSA9PiB7XG4gICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICBjYihlcnIpXG4gICAgICB9LFxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBtYWtlUmVxdWVzdFN0cmVhbSB3aWxsIGJlIHVzZWQgZGlyZWN0bHkgaW5zdGVhZCBvZiBtYWtlUmVxdWVzdCBpbiBjYXNlIHRoZSBwYXlsb2FkXG4gICAqIGlzIGF2YWlsYWJsZSBhcyBhIHN0cmVhbS4gZm9yIGV4LiBwdXRPYmplY3RcbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgdXNlIGBtYWtlUmVxdWVzdFN0cmVhbUFzeW5jYCBpbnN0ZWFkXG4gICAqL1xuICBtYWtlUmVxdWVzdFN0cmVhbShcbiAgICBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uLFxuICAgIHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlIHwgQnVmZmVyLFxuICAgIHNoYTI1NnN1bTogc3RyaW5nLFxuICAgIHN0YXR1c0NvZGVzOiBudW1iZXJbXSxcbiAgICByZWdpb246IHN0cmluZyxcbiAgICByZXR1cm5SZXNwb25zZTogYm9vbGVhbixcbiAgICBjYjogKGNiOiB1bmtub3duLCByZXN1bHQ6IGh0dHAuSW5jb21pbmdNZXNzYWdlKSA9PiB2b2lkLFxuICApIHtcbiAgICBjb25zdCBleGVjdXRvciA9IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RTdHJlYW1Bc3luYyhvcHRpb25zLCBzdHJlYW0sIHNoYTI1NnN1bSwgc3RhdHVzQ29kZXMsIHJlZ2lvbilcbiAgICAgIGlmICghcmV0dXJuUmVzcG9uc2UpIHtcbiAgICAgICAgYXdhaXQgZHJhaW5SZXNwb25zZShyZXMpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXNcbiAgICB9XG5cbiAgICBleGVjdXRvcigpLnRoZW4oXG4gICAgICAocmVzdWx0KSA9PiBjYihudWxsLCByZXN1bHQpLFxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgKGVycikgPT4gY2IoZXJyKSxcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogQGRlcHJlY2F0ZWQgdXNlIGBnZXRCdWNrZXRSZWdpb25Bc3luY2AgaW5zdGVhZFxuICAgKi9cbiAgZ2V0QnVja2V0UmVnaW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgY2I6IChlcnI6IHVua25vd24sIHJlZ2lvbjogc3RyaW5nKSA9PiB2b2lkKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QnVja2V0UmVnaW9uQXN5bmMoYnVja2V0TmFtZSkudGhlbihcbiAgICAgIChyZXN1bHQpID0+IGNiKG51bGwsIHJlc3VsdCksXG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAoZXJyKSA9PiBjYihlcnIpLFxuICAgIClcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldChidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+XG5cbiAgLyoqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBwcm9taXNlIHN0eWxlIEFQSVxuICAgKi9cbiAgcmVtb3ZlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZywgY2FsbGJhY2s6IE5vUmVzdWx0Q2FsbGJhY2spOiB2b2lkXG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSB9LCAnJywgWzIwNF0pXG4gICAgZGVsZXRlIHRoaXMucmVnaW9uTWFwW2J1Y2tldE5hbWVdXG4gIH1cblxuICAvKipcbiAgICogU3RhdCBpbmZvcm1hdGlvbiBvZiB0aGUgb2JqZWN0LlxuICAgKi9cbiAgYXN5bmMgc3RhdE9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgc3RhdE9wdHM6IFN0YXRPYmplY3RPcHRzID0ge30pOiBQcm9taXNlPEJ1Y2tldEl0ZW1TdGF0PiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIWlzT2JqZWN0KHN0YXRPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignc3RhdE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgY29uc3QgcXVlcnkgPSBxcy5zdHJpbmdpZnkoc3RhdE9wdHMpXG4gICAgY29uc3QgbWV0aG9kID0gJ0hFQUQnXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSlcblxuICAgIHJldHVybiB7XG4gICAgICBzaXplOiBwYXJzZUludChyZXMuaGVhZGVyc1snY29udGVudC1sZW5ndGgnXSBhcyBzdHJpbmcpLFxuICAgICAgbWV0YURhdGE6IGV4dHJhY3RNZXRhZGF0YShyZXMuaGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgICBsYXN0TW9kaWZpZWQ6IG5ldyBEYXRlKHJlcy5oZWFkZXJzWydsYXN0LW1vZGlmaWVkJ10gYXMgc3RyaW5nKSxcbiAgICAgIHZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlcy5oZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICAgIGV0YWc6IHNhbml0aXplRVRhZyhyZXMuaGVhZGVycy5ldGFnKSxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlIHRoZSBzcGVjaWZpZWQgb2JqZWN0LlxuICAgKiBAZGVwcmVjYXRlZCB1c2UgbmV3IHByb21pc2Ugc3R5bGUgQVBJXG4gICAqL1xuICByZW1vdmVPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHJlbW92ZU9wdHM6IFJlbW92ZU9wdGlvbnMsIGNhbGxiYWNrOiBOb1Jlc3VsdENhbGxiYWNrKTogdm9pZFxuICAvKipcbiAgICogQGRlcHJlY2F0ZWQgdXNlIG5ldyBwcm9taXNlIHN0eWxlIEFQSVxuICAgKi9cbiAgLy8gQHRzLWlnbm9yZVxuICByZW1vdmVPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiBOb1Jlc3VsdENhbGxiYWNrKTogdm9pZFxuICBhc3luYyByZW1vdmVPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHJlbW92ZU9wdHM/OiBSZW1vdmVPcHRpb25zKTogUHJvbWlzZTx2b2lkPlxuXG4gIGFzeW5jIHJlbW92ZU9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgcmVtb3ZlT3B0czogUmVtb3ZlT3B0aW9ucyA9IHt9KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIWlzT2JqZWN0KHJlbW92ZU9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdyZW1vdmVPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG4gICAgaWYgKHJlbW92ZU9wdHMuZ292ZXJuYW5jZUJ5cGFzcykge1xuICAgICAgaGVhZGVyc1snWC1BbXotQnlwYXNzLUdvdmVybmFuY2UtUmV0ZW50aW9uJ10gPSB0cnVlXG4gICAgfVxuICAgIGlmIChyZW1vdmVPcHRzLmZvcmNlRGVsZXRlKSB7XG4gICAgICBoZWFkZXJzWyd4LW1pbmlvLWZvcmNlLWRlbGV0ZSddID0gdHJ1ZVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5UGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cbiAgICBpZiAocmVtb3ZlT3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5UGFyYW1zLnZlcnNpb25JZCA9IGAke3JlbW92ZU9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgcXVlcnkgPSBxcy5zdHJpbmdpZnkocXVlcnlQYXJhbXMpXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzLCBxdWVyeSB9LCAnJywgWzIwMCwgMjA0XSlcbiAgfVxuXG4gIC8vIENhbGxzIGltcGxlbWVudGVkIGJlbG93IGFyZSByZWxhdGVkIHRvIG11bHRpcGFydC5cblxuICAvKipcbiAgICogSW5pdGlhdGUgYSBuZXcgbXVsdGlwYXJ0IHVwbG9hZC5cbiAgICogQGludGVybmFsXG4gICAqL1xuICBhc3luYyBpbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QoaGVhZGVycykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcignY29udGVudFR5cGUgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdQT1NUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3VwbG9hZHMnXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSwgaGVhZGVycyB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNCdWZmZXIocmVzKVxuICAgIHJldHVybiBwYXJzZUluaXRpYXRlTXVsdGlwYXJ0KGJvZHkudG9TdHJpbmcoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBNZXRob2QgdG8gYWJvcnQgYSBtdWx0aXBhcnQgdXBsb2FkIHJlcXVlc3QgaW4gY2FzZSBvZiBhbnkgZXJyb3JzLlxuICAgKlxuICAgKiBAcGFyYW0gYnVja2V0TmFtZSAtIEJ1Y2tldCBOYW1lXG4gICAqIEBwYXJhbSBvYmplY3ROYW1lIC0gT2JqZWN0IE5hbWVcbiAgICogQHBhcmFtIHVwbG9hZElkIC0gaWQgb2YgYSBtdWx0aXBhcnQgdXBsb2FkIHRvIGNhbmNlbCBkdXJpbmcgY29tcG9zZSBvYmplY3Qgc2VxdWVuY2UuXG4gICAqL1xuICBhc3luYyBhYm9ydE11bHRpcGFydFVwbG9hZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgdXBsb2FkSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgY29uc3QgcXVlcnkgPSBgdXBsb2FkSWQ9JHt1cGxvYWRJZH1gXG5cbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lOiBvYmplY3ROYW1lLCBxdWVyeSB9XG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChyZXF1ZXN0T3B0aW9ucywgJycsIFsyMDRdKVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCBwYXJ0LWluZm8gb2YgYWxsIHBhcnRzIG9mIGFuIGluY29tcGxldGUgdXBsb2FkIHNwZWNpZmllZCBieSB1cGxvYWRJZC5cbiAgICovXG4gIHByb3RlY3RlZCBhc3luYyBsaXN0UGFydHMoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHVwbG9hZElkOiBzdHJpbmcpOiBQcm9taXNlPFVwbG9hZGVkUGFydFtdPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyh1cGxvYWRJZCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VwbG9hZElkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIXVwbG9hZElkKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd1cGxvYWRJZCBjYW5ub3QgYmUgZW1wdHknKVxuICAgIH1cblxuICAgIGNvbnN0IHBhcnRzOiBVcGxvYWRlZFBhcnRbXSA9IFtdXG4gICAgbGV0IG1hcmtlciA9IDBcbiAgICBsZXQgcmVzdWx0XG4gICAgZG8ge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5saXN0UGFydHNRdWVyeShidWNrZXROYW1lLCBvYmplY3ROYW1lLCB1cGxvYWRJZCwgbWFya2VyKVxuICAgICAgbWFya2VyID0gcmVzdWx0Lm1hcmtlclxuICAgICAgcGFydHMucHVzaCguLi5yZXN1bHQucGFydHMpXG4gICAgfSB3aGlsZSAocmVzdWx0LmlzVHJ1bmNhdGVkKVxuXG4gICAgcmV0dXJuIHBhcnRzXG4gIH1cblxuICAvKipcbiAgICogQ2FsbGVkIGJ5IGxpc3RQYXJ0cyB0byBmZXRjaCBhIGJhdGNoIG9mIHBhcnQtaW5mb1xuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBsaXN0UGFydHNRdWVyeShidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgdXBsb2FkSWQ6IHN0cmluZywgbWFya2VyOiBudW1iZXIpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHVwbG9hZElkKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndXBsb2FkSWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNOdW1iZXIobWFya2VyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWFya2VyIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cbiAgICBpZiAoIXVwbG9hZElkKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd1cGxvYWRJZCBjYW5ub3QgYmUgZW1wdHknKVxuICAgIH1cblxuICAgIGxldCBxdWVyeSA9IGB1cGxvYWRJZD0ke3VyaUVzY2FwZSh1cGxvYWRJZCl9YFxuICAgIGlmIChtYXJrZXIpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmcGFydC1udW1iZXItbWFya2VyPSR7bWFya2VyfWBcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSlcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUxpc3RQYXJ0cyhhd2FpdCByZWFkQXNTdHJpbmcocmVzKSlcbiAgfVxuXG4gIGFzeW5jIGxpc3RCdWNrZXRzKCk6IFByb21pc2U8QnVja2V0SXRlbUZyb21MaXN0W10+IHtcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IGh0dHBSZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QgfSwgJycsIFsyMDBdLCBERUZBVUxUX1JFR0lPTilcbiAgICBjb25zdCB4bWxSZXN1bHQgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUxpc3RCdWNrZXQoeG1sUmVzdWx0KVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPlxuICByZW1vdmVCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiBOb1Jlc3VsdENhbGxiYWNrKTogdm9pZFxuICBhc3luYyByZW1vdmVCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3JlcGxpY2F0aW9uJ1xuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwLCAyMDRdLCAnJylcbiAgfVxuXG4gIHNldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgcmVwbGljYXRpb25Db25maWc6IFJlcGxpY2F0aW9uQ29uZmlnT3B0cywgY2FsbGJhY2s6IE5vUmVzdWx0Q2FsbGJhY2spOiB2b2lkXG4gIGFzeW5jIHNldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgcmVwbGljYXRpb25Db25maWc6IFJlcGxpY2F0aW9uQ29uZmlnT3B0cyk6IFByb21pc2U8dm9pZD5cbiAgYXN5bmMgc2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nLCByZXBsaWNhdGlvbkNvbmZpZzogUmVwbGljYXRpb25Db25maWdPcHRzKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChyZXBsaWNhdGlvbkNvbmZpZykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3JlcGxpY2F0aW9uQ29uZmlnIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoXy5pc0VtcHR5KHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ1JvbGUgY2Fubm90IGJlIGVtcHR5JylcbiAgICAgIH0gZWxzZSBpZiAocmVwbGljYXRpb25Db25maWcucm9sZSAmJiAhaXNTdHJpbmcocmVwbGljYXRpb25Db25maWcucm9sZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW52YWxpZCB2YWx1ZSBmb3Igcm9sZScsIHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUpXG4gICAgICB9XG4gICAgICBpZiAoXy5pc0VtcHR5KHJlcGxpY2F0aW9uQ29uZmlnLnJ1bGVzKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdNaW5pbXVtIG9uZSByZXBsaWNhdGlvbiBydWxlIG11c3QgYmUgc3BlY2lmaWVkJylcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9ICdyZXBsaWNhdGlvbidcbiAgICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cblxuICAgIGNvbnN0IHJlcGxpY2F0aW9uUGFyYW1zQ29uZmlnID0ge1xuICAgICAgUmVwbGljYXRpb25Db25maWd1cmF0aW9uOiB7XG4gICAgICAgIFJvbGU6IHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUsXG4gICAgICAgIFJ1bGU6IHJlcGxpY2F0aW9uQ29uZmlnLnJ1bGVzLFxuICAgICAgfSxcbiAgICB9XG5cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHsgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sIGhlYWRsZXNzOiB0cnVlIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QocmVwbGljYXRpb25QYXJhbXNDb25maWcpXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZClcbiAgfVxuXG4gIGdldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgY2FsbGJhY2s6IFJlc3VsdENhbGxiYWNrPFJlcGxpY2F0aW9uQ29uZmlnPik6IHZvaWRcbiAgYXN5bmMgZ2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxSZXBsaWNhdGlvbkNvbmZpZz5cbiAgYXN5bmMgZ2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICdyZXBsaWNhdGlvbidcblxuICAgIGNvbnN0IGh0dHBSZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwLCAyMDRdKVxuICAgIGNvbnN0IHhtbFJlc3VsdCA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJz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