"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var http = _interopRequireWildcard(require("http"), true);
var https = _interopRequireWildcard(require("https"), true);
var _browserOrNode = require("browser-or-node");
var _lodash = require("lodash");
var qs = _interopRequireWildcard(require("query-string"), true);
var _xml2js = require("xml2js");
var _CredentialProvider = require("../CredentialProvider.js");
var errors = _interopRequireWildcard(require("../errors.js"), true);
var _helpers = require("../helpers.js");
var _signing = require("../signing.js");
var _extensions = require("./extensions.js");
var _helper = require("./helper.js");
var _request = require("./request.js");
var _response = require("./response.js");
var _s3Endpoints = require("./s3-endpoints.js");
var xmlParsers = _interopRequireWildcard(require("./xml-parser.js"), true);
function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function (nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }
function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }
// will be replaced by bundler.
const Package = {
  version: "7.1.3" || 'development'
};
const requestOptionProperties = ['agent', 'ca', 'cert', 'ciphers', 'clientCertEngine', 'crl', 'dhparam', 'ecdhCurve', 'family', 'honorCipherOrder', 'key', 'passphrase', 'pfx', 'rejectUnauthorized', 'secureOptions', 'secureProtocol', 'servername', 'sessionIdContext'];
class TypedClient {
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
    if (!(0, _helper.isValidEndpoint)(params.endPoint)) {
      throw new errors.InvalidEndpointError(`Invalid endPoint : ${params.endPoint}`);
    }
    if (!(0, _helper.isValidPort)(params.port)) {
      throw new errors.InvalidArgumentError(`Invalid port : ${params.port}`);
    }
    if (!(0, _helper.isBoolean)(params.useSSL)) {
      throw new errors.InvalidArgumentError(`Invalid useSSL flag type : ${params.useSSL}, expected to be of type "boolean"`);
    }

    // Validate region only if its set.
    if (params.region) {
      if (!(0, _helper.isString)(params.region)) {
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
      if (!(0, _helper.isObject)(params.transport)) {
        throw new errors.InvalidArgumentError(`Invalid transport type : ${params.transport}, expected to be type "object"`);
      }
      transport = params.transport;
    }

    // if custom transport agent is set, use it.
    if (params.transportAgent) {
      if (!(0, _helper.isObject)(params.transportAgent)) {
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
    this.clientExtensions = new _extensions.Extensions(this);
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
    if (!(0, _helper.isObject)(options)) {
      throw new TypeError('request options should be of type "object"');
    }
    this.reqOptions = _lodash.pick(options, requestOptionProperties);
  }

  /**
   *  This is s3 Specific and does not hold validity in any other Object storage.
   */
  getAccelerateEndPointIfSet(bucketName, objectName) {
    if (!(0, _helper.isEmpty)(this.s3AccelerateEndpoint) && !(0, _helper.isEmpty)(bucketName) && !(0, _helper.isEmpty)(objectName)) {
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
      virtualHostStyle = (0, _helper.isVirtualHostStyle)(this.host, this.protocol, bucketName, this.pathStyle);
    }
    let path = '/';
    let host = this.host;
    let port;
    if (this.port) {
      port = this.port;
    }
    if (objectName) {
      objectName = (0, _helper.uriResourceEscape)(objectName);
    }

    // For Amazon S3 endpoint, get endpoint based on region.
    if ((0, _helper.isAmazonEndpoint)(host)) {
      const accelerateEndPoint = this.getAccelerateEndPointIfSet(bucketName, objectName);
      if (accelerateEndPoint) {
        host = `${accelerateEndPoint}`;
      } else {
        host = (0, _s3Endpoints.getS3Endpoint)(region);
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
      headers: _lodash.mapValues(_lodash.pickBy(reqOptions.headers, _helper.isDefined), v => v.toString()),
      host,
      port,
      path
    };
  }
  async setCredentialsProvider(credentialsProvider) {
    if (!(credentialsProvider instanceof _CredentialProvider.CredentialProvider)) {
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
    if (!(0, _helper.isObject)(reqOptions)) {
      throw new TypeError('reqOptions should be of type "object"');
    }
    if (response && !(0, _helper.isReadableStream)(response)) {
      throw new TypeError('response should be of type "Stream"');
    }
    if (err && !(err instanceof Error)) {
      throw new TypeError('err should be of type "Error"');
    }
    const logStream = this.logStream;
    const logHeaders = headers => {
      Object.entries(headers).forEach(([k, v]) => {
        if (k == 'authorization') {
          if ((0, _helper.isString)(v)) {
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
    if (!(0, _helper.isObject)(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!(0, _helper.isString)(payload) && !(0, _helper.isObject)(payload)) {
      // Buffer is of type 'object'
      throw new TypeError('payload should be of type "string" or "Buffer"');
    }
    expectedCodes.forEach(statusCode => {
      if (!(0, _helper.isNumber)(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!(0, _helper.isString)(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (!options.headers) {
      options.headers = {};
    }
    if (options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE') {
      options.headers['content-length'] = payload.length.toString();
    }
    const sha256sum = this.enableSHA256 ? (0, _helper.toSha256)(payload) : '';
    return this.makeRequestStreamAsync(options, payload, sha256sum, expectedCodes, region);
  }

  /**
   * new request with promise
   *
   * No need to drain response, response body is not valid
   */
  async makeRequestAsyncOmit(options, payload = '', statusCodes = [200], region = '') {
    const res = await this.makeRequestAsync(options, payload, statusCodes, region);
    await (0, _response.drainResponse)(res);
    return res;
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @internal
   */
  async makeRequestStreamAsync(options, body, sha256sum, statusCodes, region) {
    if (!(0, _helper.isObject)(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!(Buffer.isBuffer(body) || typeof body === 'string' || (0, _helper.isReadableStream)(body))) {
      throw new errors.InvalidArgumentError(`stream should be a Buffer, string or readable Stream, got ${typeof body} instead`);
    }
    if (!(0, _helper.isString)(sha256sum)) {
      throw new TypeError('sha256sum should be of type "string"');
    }
    statusCodes.forEach(statusCode => {
      if (!(0, _helper.isNumber)(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!(0, _helper.isString)(region)) {
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
      reqOptions.headers['x-amz-date'] = (0, _helper.makeDateLong)(date);
      reqOptions.headers['x-amz-content-sha256'] = sha256sum;
      if (this.sessionToken) {
        reqOptions.headers['x-amz-security-token'] = this.sessionToken;
      }
      reqOptions.headers.authorization = (0, _signing.signV4)(reqOptions, this.accessKey, this.secretKey, region, date, sha256sum);
    }
    const response = await (0, _request.request)(this.transport, reqOptions, body);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
      const body = await (0, _response.readAsString)(response);
      const region = xmlParsers.parseBucketRegion(body) || _helpers.DEFAULT_REGION;
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
    const pathStyle = this.pathStyle && !_browserOrNode.isBrowser;
    let region;
    try {
      const res = await this.makeRequestAsync({
        method,
        bucketName,
        query,
        pathStyle
      }, '', [200], _helpers.DEFAULT_REGION);
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
        await (0, _response.drainResponse)(res);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(statOpts)) {
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
      metaData: (0, _helper.extractMetadata)(res.headers),
      lastModified: new Date(res.headers['last-modified']),
      versionId: (0, _helper.getVersionId)(res.headers),
      etag: (0, _helper.sanitizeETag)(res.headers.etag)
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(removeOpts)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(headers)) {
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
    const body = await (0, _response.readAsBuffer)(res);
    return (0, xmlParsers.parseInitiateMultipart)(body.toString());
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(uploadId)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!(0, _helper.isNumber)(marker)) {
      throw new TypeError('marker should be of type "number"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    let query = `uploadId=${(0, _helper.uriEscape)(uploadId)}`;
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
    return xmlParsers.parseListParts(await (0, _response.readAsString)(res));
  }
  async listBuckets() {
    const method = 'GET';
    const httpRes = await this.makeRequestAsync({
      method
    }, '', [200], _helpers.DEFAULT_REGION);
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return xmlParsers.parseListBucket(xmlResult);
  }
  async removeBucketReplication(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isObject)(replicationConfig)) {
      throw new errors.InvalidArgumentError('replicationConfig should be of type "object"');
    } else {
      if (_lodash.isEmpty(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Role cannot be empty');
      } else if (replicationConfig.role && !(0, _helper.isString)(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Invalid value for role', replicationConfig.role);
      }
      if (_lodash.isEmpty(replicationConfig.rules)) {
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
    const builder = new _xml2js.Builder({
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(replicationParamsConfig);
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketReplication(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'replication';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    }, '', [200, 204]);
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return xmlParsers.parseReplicationConfig(xmlResult);
  }
}
exports.TypedClient = TypedClient;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJodHRwIiwiX2ludGVyb3BSZXF1aXJlV2lsZGNhcmQiLCJyZXF1aXJlIiwiaHR0cHMiLCJfYnJvd3Nlck9yTm9kZSIsIl9sb2Rhc2giLCJxcyIsIl94bWwyanMiLCJfQ3JlZGVudGlhbFByb3ZpZGVyIiwiZXJyb3JzIiwiX2hlbHBlcnMiLCJfc2lnbmluZyIsIl9leHRlbnNpb25zIiwiX2hlbHBlciIsIl9yZXF1ZXN0IiwiX3Jlc3BvbnNlIiwiX3MzRW5kcG9pbnRzIiwieG1sUGFyc2VycyIsIl9nZXRSZXF1aXJlV2lsZGNhcmRDYWNoZSIsIm5vZGVJbnRlcm9wIiwiV2Vha01hcCIsImNhY2hlQmFiZWxJbnRlcm9wIiwiY2FjaGVOb2RlSW50ZXJvcCIsIm9iaiIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiY2FjaGUiLCJoYXMiLCJnZXQiLCJuZXdPYmoiLCJoYXNQcm9wZXJ0eURlc2NyaXB0b3IiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsImdldE93blByb3BlcnR5RGVzY3JpcHRvciIsImtleSIsInByb3RvdHlwZSIsImhhc093blByb3BlcnR5IiwiY2FsbCIsImRlc2MiLCJzZXQiLCJQYWNrYWdlIiwidmVyc2lvbiIsInJlcXVlc3RPcHRpb25Qcm9wZXJ0aWVzIiwiVHlwZWRDbGllbnQiLCJwYXJ0U2l6ZSIsIm1heGltdW1QYXJ0U2l6ZSIsIm1heE9iamVjdFNpemUiLCJjb25zdHJ1Y3RvciIsInBhcmFtcyIsInNlY3VyZSIsInVuZGVmaW5lZCIsIkVycm9yIiwidXNlU1NMIiwicG9ydCIsImlzVmFsaWRFbmRwb2ludCIsImVuZFBvaW50IiwiSW52YWxpZEVuZHBvaW50RXJyb3IiLCJpc1ZhbGlkUG9ydCIsIkludmFsaWRBcmd1bWVudEVycm9yIiwiaXNCb29sZWFuIiwicmVnaW9uIiwiaXNTdHJpbmciLCJob3N0IiwidG9Mb3dlckNhc2UiLCJwcm90b2NvbCIsInRyYW5zcG9ydCIsInRyYW5zcG9ydEFnZW50IiwiZ2xvYmFsQWdlbnQiLCJpc09iamVjdCIsImxpYnJhcnlDb21tZW50cyIsInByb2Nlc3MiLCJwbGF0Zm9ybSIsImFyY2giLCJsaWJyYXJ5QWdlbnQiLCJ1c2VyQWdlbnQiLCJwYXRoU3R5bGUiLCJhY2Nlc3NLZXkiLCJzZWNyZXRLZXkiLCJzZXNzaW9uVG9rZW4iLCJhbm9ueW1vdXMiLCJjcmVkZW50aWFsc1Byb3ZpZGVyIiwicmVnaW9uTWFwIiwib3ZlclJpZGVQYXJ0U2l6ZSIsImVuYWJsZVNIQTI1NiIsInMzQWNjZWxlcmF0ZUVuZHBvaW50IiwicmVxT3B0aW9ucyIsImNsaWVudEV4dGVuc2lvbnMiLCJFeHRlbnNpb25zIiwiZXh0ZW5zaW9ucyIsInNldFMzVHJhbnNmZXJBY2NlbGVyYXRlIiwic2V0UmVxdWVzdE9wdGlvbnMiLCJvcHRpb25zIiwiVHlwZUVycm9yIiwiXyIsInBpY2siLCJnZXRBY2NlbGVyYXRlRW5kUG9pbnRJZlNldCIsImJ1Y2tldE5hbWUiLCJvYmplY3ROYW1lIiwiaXNFbXB0eSIsImluY2x1ZGVzIiwiZ2V0UmVxdWVzdE9wdGlvbnMiLCJvcHRzIiwibWV0aG9kIiwiaGVhZGVycyIsInF1ZXJ5IiwiYWdlbnQiLCJ2aXJ0dWFsSG9zdFN0eWxlIiwiaXNWaXJ0dWFsSG9zdFN0eWxlIiwicGF0aCIsInVyaVJlc291cmNlRXNjYXBlIiwiaXNBbWF6b25FbmRwb2ludCIsImFjY2VsZXJhdGVFbmRQb2ludCIsImdldFMzRW5kcG9pbnQiLCJrIiwidiIsImVudHJpZXMiLCJhc3NpZ24iLCJtYXBWYWx1ZXMiLCJwaWNrQnkiLCJpc0RlZmluZWQiLCJ0b1N0cmluZyIsInNldENyZWRlbnRpYWxzUHJvdmlkZXIiLCJDcmVkZW50aWFsUHJvdmlkZXIiLCJjaGVja0FuZFJlZnJlc2hDcmVkcyIsImNyZWRlbnRpYWxzQ29uZiIsImdldENyZWRlbnRpYWxzIiwiZ2V0QWNjZXNzS2V5IiwiZ2V0U2VjcmV0S2V5IiwiZ2V0U2Vzc2lvblRva2VuIiwiZSIsImNhdXNlIiwibG9nSFRUUCIsInJlc3BvbnNlIiwiZXJyIiwibG9nU3RyZWFtIiwiaXNSZWFkYWJsZVN0cmVhbSIsImxvZ0hlYWRlcnMiLCJmb3JFYWNoIiwicmVkYWN0b3IiLCJSZWdFeHAiLCJyZXBsYWNlIiwid3JpdGUiLCJzdGF0dXNDb2RlIiwiZXJySlNPTiIsIkpTT04iLCJzdHJpbmdpZnkiLCJ0cmFjZU9uIiwic3RyZWFtIiwic3Rkb3V0IiwidHJhY2VPZmYiLCJtYWtlUmVxdWVzdEFzeW5jIiwicGF5bG9hZCIsImV4cGVjdGVkQ29kZXMiLCJpc051bWJlciIsImxlbmd0aCIsInNoYTI1NnN1bSIsInRvU2hhMjU2IiwibWFrZVJlcXVlc3RTdHJlYW1Bc3luYyIsIm1ha2VSZXF1ZXN0QXN5bmNPbWl0Iiwic3RhdHVzQ29kZXMiLCJyZXMiLCJkcmFpblJlc3BvbnNlIiwiYm9keSIsIkJ1ZmZlciIsImlzQnVmZmVyIiwiZ2V0QnVja2V0UmVnaW9uQXN5bmMiLCJkYXRlIiwiRGF0ZSIsIm1ha2VEYXRlTG9uZyIsImF1dGhvcml6YXRpb24iLCJzaWduVjQiLCJyZXF1ZXN0IiwicGFyc2VSZXNwb25zZUVycm9yIiwiaXNWYWxpZEJ1Y2tldE5hbWUiLCJJbnZhbGlkQnVja2V0TmFtZUVycm9yIiwiY2FjaGVkIiwiZXh0cmFjdFJlZ2lvbkFzeW5jIiwicmVhZEFzU3RyaW5nIiwicGFyc2VCdWNrZXRSZWdpb24iLCJERUZBVUxUX1JFR0lPTiIsImlzQnJvd3NlciIsIm5hbWUiLCJSZWdpb24iLCJtYWtlUmVxdWVzdCIsInJldHVyblJlc3BvbnNlIiwiY2IiLCJwcm9tIiwidGhlbiIsInJlc3VsdCIsIm1ha2VSZXF1ZXN0U3RyZWFtIiwiZXhlY3V0b3IiLCJnZXRCdWNrZXRSZWdpb24iLCJyZW1vdmVCdWNrZXQiLCJzdGF0T2JqZWN0Iiwic3RhdE9wdHMiLCJpc1ZhbGlkT2JqZWN0TmFtZSIsIkludmFsaWRPYmplY3ROYW1lRXJyb3IiLCJzaXplIiwicGFyc2VJbnQiLCJtZXRhRGF0YSIsImV4dHJhY3RNZXRhZGF0YSIsImxhc3RNb2RpZmllZCIsInZlcnNpb25JZCIsImdldFZlcnNpb25JZCIsImV0YWciLCJzYW5pdGl6ZUVUYWciLCJyZW1vdmVPYmplY3QiLCJyZW1vdmVPcHRzIiwiZ292ZXJuYW5jZUJ5cGFzcyIsImZvcmNlRGVsZXRlIiwicXVlcnlQYXJhbXMiLCJpbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZCIsInJlYWRBc0J1ZmZlciIsInBhcnNlSW5pdGlhdGVNdWx0aXBhcnQiLCJhYm9ydE11bHRpcGFydFVwbG9hZCIsInVwbG9hZElkIiwicmVxdWVzdE9wdGlvbnMiLCJsaXN0UGFydHMiLCJwYXJ0cyIsIm1hcmtlciIsImxpc3RQYXJ0c1F1ZXJ5IiwicHVzaCIsImlzVHJ1bmNhdGVkIiwidXJpRXNjYXBlIiwicGFyc2VMaXN0UGFydHMiLCJsaXN0QnVja2V0cyIsImh0dHBSZXMiLCJ4bWxSZXN1bHQiLCJwYXJzZUxpc3RCdWNrZXQiLCJyZW1vdmVCdWNrZXRSZXBsaWNhdGlvbiIsInNldEJ1Y2tldFJlcGxpY2F0aW9uIiwicmVwbGljYXRpb25Db25maWciLCJyb2xlIiwicnVsZXMiLCJyZXBsaWNhdGlvblBhcmFtc0NvbmZpZyIsIlJlcGxpY2F0aW9uQ29uZmlndXJhdGlvbiIsIlJvbGUiLCJSdWxlIiwiYnVpbGRlciIsInhtbDJqcyIsIkJ1aWxkZXIiLCJyZW5kZXJPcHRzIiwicHJldHR5IiwiaGVhZGxlc3MiLCJidWlsZE9iamVjdCIsInRvTWQ1IiwiZ2V0QnVja2V0UmVwbGljYXRpb24iLCJwYXJzZVJlcGxpY2F0aW9uQ29uZmlnIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbImNsaWVudC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBodHRwIGZyb20gJ25vZGU6aHR0cCdcbmltcG9ydCAqIGFzIGh0dHBzIGZyb20gJ25vZGU6aHR0cHMnXG5pbXBvcnQgdHlwZSAqIGFzIHN0cmVhbSBmcm9tICdub2RlOnN0cmVhbSdcblxuaW1wb3J0IHsgaXNCcm93c2VyIH0gZnJvbSAnYnJvd3Nlci1vci1ub2RlJ1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJ1xuaW1wb3J0ICogYXMgcXMgZnJvbSAncXVlcnktc3RyaW5nJ1xuaW1wb3J0IHhtbDJqcyBmcm9tICd4bWwyanMnXG5cbmltcG9ydCB7IENyZWRlbnRpYWxQcm92aWRlciB9IGZyb20gJy4uL0NyZWRlbnRpYWxQcm92aWRlci50cydcbmltcG9ydCAqIGFzIGVycm9ycyBmcm9tICcuLi9lcnJvcnMudHMnXG5pbXBvcnQgeyBERUZBVUxUX1JFR0lPTiB9IGZyb20gJy4uL2hlbHBlcnMudHMnXG5pbXBvcnQgeyBzaWduVjQgfSBmcm9tICcuLi9zaWduaW5nLnRzJ1xuaW1wb3J0IHsgRXh0ZW5zaW9ucyB9IGZyb20gJy4vZXh0ZW5zaW9ucy50cydcbmltcG9ydCB7XG4gIGV4dHJhY3RNZXRhZGF0YSxcbiAgZ2V0VmVyc2lvbklkLFxuICBpc0FtYXpvbkVuZHBvaW50LFxuICBpc0Jvb2xlYW4sXG4gIGlzRGVmaW5lZCxcbiAgaXNFbXB0eSxcbiAgaXNOdW1iZXIsXG4gIGlzT2JqZWN0LFxuICBpc1JlYWRhYmxlU3RyZWFtLFxuICBpc1N0cmluZyxcbiAgaXNWYWxpZEJ1Y2tldE5hbWUsXG4gIGlzVmFsaWRFbmRwb2ludCxcbiAgaXNWYWxpZE9iamVjdE5hbWUsXG4gIGlzVmFsaWRQb3J0LFxuICBpc1ZpcnR1YWxIb3N0U3R5bGUsXG4gIG1ha2VEYXRlTG9uZyxcbiAgc2FuaXRpemVFVGFnLFxuICB0b01kNSxcbiAgdG9TaGEyNTYsXG4gIHVyaUVzY2FwZSxcbiAgdXJpUmVzb3VyY2VFc2NhcGUsXG59IGZyb20gJy4vaGVscGVyLnRzJ1xuaW1wb3J0IHsgcmVxdWVzdCB9IGZyb20gJy4vcmVxdWVzdC50cydcbmltcG9ydCB7IGRyYWluUmVzcG9uc2UsIHJlYWRBc0J1ZmZlciwgcmVhZEFzU3RyaW5nIH0gZnJvbSAnLi9yZXNwb25zZS50cydcbmltcG9ydCB0eXBlIHsgUmVnaW9uIH0gZnJvbSAnLi9zMy1lbmRwb2ludHMudHMnXG5pbXBvcnQgeyBnZXRTM0VuZHBvaW50IH0gZnJvbSAnLi9zMy1lbmRwb2ludHMudHMnXG5pbXBvcnQgdHlwZSB7XG4gIEJpbmFyeSxcbiAgQnVja2V0SXRlbUZyb21MaXN0LFxuICBCdWNrZXRJdGVtU3RhdCxcbiAgSVJlcXVlc3QsXG4gIFJlcGxpY2F0aW9uQ29uZmlnLFxuICBSZXBsaWNhdGlvbkNvbmZpZ09wdHMsXG4gIFJlcXVlc3RIZWFkZXJzLFxuICBSZXNwb25zZUhlYWRlcixcbiAgUmVzdWx0Q2FsbGJhY2ssXG4gIFN0YXRPYmplY3RPcHRzLFxuICBUcmFuc3BvcnQsXG59IGZyb20gJy4vdHlwZS50cydcbmltcG9ydCB0eXBlIHsgVXBsb2FkZWRQYXJ0IH0gZnJvbSAnLi94bWwtcGFyc2VyLnRzJ1xuaW1wb3J0ICogYXMgeG1sUGFyc2VycyBmcm9tICcuL3htbC1wYXJzZXIudHMnXG5pbXBvcnQgeyBwYXJzZUluaXRpYXRlTXVsdGlwYXJ0IH0gZnJvbSAnLi94bWwtcGFyc2VyLnRzJ1xuXG4vLyB3aWxsIGJlIHJlcGxhY2VkIGJ5IGJ1bmRsZXIuXG5jb25zdCBQYWNrYWdlID0geyB2ZXJzaW9uOiBwcm9jZXNzLmVudi5NSU5JT19KU19QQUNLQUdFX1ZFUlNJT04gfHwgJ2RldmVsb3BtZW50JyB9XG5cbmNvbnN0IHJlcXVlc3RPcHRpb25Qcm9wZXJ0aWVzID0gW1xuICAnYWdlbnQnLFxuICAnY2EnLFxuICAnY2VydCcsXG4gICdjaXBoZXJzJyxcbiAgJ2NsaWVudENlcnRFbmdpbmUnLFxuICAnY3JsJyxcbiAgJ2RocGFyYW0nLFxuICAnZWNkaEN1cnZlJyxcbiAgJ2ZhbWlseScsXG4gICdob25vckNpcGhlck9yZGVyJyxcbiAgJ2tleScsXG4gICdwYXNzcGhyYXNlJyxcbiAgJ3BmeCcsXG4gICdyZWplY3RVbmF1dGhvcml6ZWQnLFxuICAnc2VjdXJlT3B0aW9ucycsXG4gICdzZWN1cmVQcm90b2NvbCcsXG4gICdzZXJ2ZXJuYW1lJyxcbiAgJ3Nlc3Npb25JZENvbnRleHQnLFxuXSBhcyBjb25zdFxuXG5leHBvcnQgaW50ZXJmYWNlIENsaWVudE9wdGlvbnMge1xuICBlbmRQb2ludDogc3RyaW5nXG4gIGFjY2Vzc0tleTogc3RyaW5nXG4gIHNlY3JldEtleTogc3RyaW5nXG4gIHVzZVNTTD86IGJvb2xlYW5cbiAgcG9ydD86IG51bWJlclxuICByZWdpb24/OiBSZWdpb25cbiAgdHJhbnNwb3J0PzogVHJhbnNwb3J0XG4gIHNlc3Npb25Ub2tlbj86IHN0cmluZ1xuICBwYXJ0U2l6ZT86IG51bWJlclxuICBwYXRoU3R5bGU/OiBib29sZWFuXG4gIGNyZWRlbnRpYWxzUHJvdmlkZXI/OiBDcmVkZW50aWFsUHJvdmlkZXJcbiAgczNBY2NlbGVyYXRlRW5kcG9pbnQ/OiBzdHJpbmdcbiAgdHJhbnNwb3J0QWdlbnQ/OiBodHRwLkFnZW50XG59XG5cbmV4cG9ydCB0eXBlIFJlcXVlc3RPcHRpb24gPSBQYXJ0aWFsPElSZXF1ZXN0PiAmIHtcbiAgbWV0aG9kOiBzdHJpbmdcbiAgYnVja2V0TmFtZT86IHN0cmluZ1xuICBvYmplY3ROYW1lPzogc3RyaW5nXG4gIHF1ZXJ5Pzogc3RyaW5nXG4gIHBhdGhTdHlsZT86IGJvb2xlYW5cbn1cblxuZXhwb3J0IHR5cGUgTm9SZXN1bHRDYWxsYmFjayA9IChlcnJvcjogdW5rbm93bikgPT4gdm9pZFxuXG5leHBvcnQgaW50ZXJmYWNlIFJlbW92ZU9wdGlvbnMge1xuICB2ZXJzaW9uSWQ/OiBzdHJpbmdcbiAgZ292ZXJuYW5jZUJ5cGFzcz86IGJvb2xlYW5cbiAgZm9yY2VEZWxldGU/OiBib29sZWFuXG59XG5cbmV4cG9ydCBjbGFzcyBUeXBlZENsaWVudCB7XG4gIHByb3RlY3RlZCB0cmFuc3BvcnQ6IFRyYW5zcG9ydFxuICBwcm90ZWN0ZWQgaG9zdDogc3RyaW5nXG4gIHByb3RlY3RlZCBwb3J0OiBudW1iZXJcbiAgcHJvdGVjdGVkIHByb3RvY29sOiBzdHJpbmdcbiAgcHJvdGVjdGVkIGFjY2Vzc0tleTogc3RyaW5nXG4gIHByb3RlY3RlZCBzZWNyZXRLZXk6IHN0cmluZ1xuICBwcm90ZWN0ZWQgc2Vzc2lvblRva2VuPzogc3RyaW5nXG4gIHByb3RlY3RlZCB1c2VyQWdlbnQ6IHN0cmluZ1xuICBwcm90ZWN0ZWQgYW5vbnltb3VzOiBib29sZWFuXG4gIHByb3RlY3RlZCBwYXRoU3R5bGU6IGJvb2xlYW5cbiAgcHJvdGVjdGVkIHJlZ2lvbk1hcDogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxuICBwdWJsaWMgcmVnaW9uPzogc3RyaW5nXG4gIHByb3RlY3RlZCBjcmVkZW50aWFsc1Byb3ZpZGVyPzogQ3JlZGVudGlhbFByb3ZpZGVyXG4gIHBhcnRTaXplOiBudW1iZXIgPSA2NCAqIDEwMjQgKiAxMDI0XG4gIHByb3RlY3RlZCBvdmVyUmlkZVBhcnRTaXplPzogYm9vbGVhblxuXG4gIHByb3RlY3RlZCBtYXhpbXVtUGFydFNpemUgPSA1ICogMTAyNCAqIDEwMjQgKiAxMDI0XG4gIHByb3RlY3RlZCBtYXhPYmplY3RTaXplID0gNSAqIDEwMjQgKiAxMDI0ICogMTAyNCAqIDEwMjRcbiAgcHVibGljIGVuYWJsZVNIQTI1NjogYm9vbGVhblxuICBwcm90ZWN0ZWQgczNBY2NlbGVyYXRlRW5kcG9pbnQ/OiBzdHJpbmdcbiAgcHJvdGVjdGVkIHJlcU9wdGlvbnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+XG5cbiAgcHJvdGVjdGVkIHRyYW5zcG9ydEFnZW50OiBodHRwLkFnZW50XG4gIHByaXZhdGUgcmVhZG9ubHkgY2xpZW50RXh0ZW5zaW9uczogRXh0ZW5zaW9uc1xuXG4gIGNvbnN0cnVjdG9yKHBhcmFtczogQ2xpZW50T3B0aW9ucykge1xuICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgZGVwcmVjYXRlZCBwcm9wZXJ0eVxuICAgIGlmIChwYXJhbXMuc2VjdXJlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignXCJzZWN1cmVcIiBvcHRpb24gZGVwcmVjYXRlZCwgXCJ1c2VTU0xcIiBzaG91bGQgYmUgdXNlZCBpbnN0ZWFkJylcbiAgICB9XG4gICAgLy8gRGVmYXVsdCB2YWx1ZXMgaWYgbm90IHNwZWNpZmllZC5cbiAgICBpZiAocGFyYW1zLnVzZVNTTCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYXJhbXMudXNlU1NMID0gdHJ1ZVxuICAgIH1cbiAgICBpZiAoIXBhcmFtcy5wb3J0KSB7XG4gICAgICBwYXJhbXMucG9ydCA9IDBcbiAgICB9XG4gICAgLy8gVmFsaWRhdGUgaW5wdXQgcGFyYW1zLlxuICAgIGlmICghaXNWYWxpZEVuZHBvaW50KHBhcmFtcy5lbmRQb2ludCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEVuZHBvaW50RXJyb3IoYEludmFsaWQgZW5kUG9pbnQgOiAke3BhcmFtcy5lbmRQb2ludH1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRQb3J0KHBhcmFtcy5wb3J0KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCBwb3J0IDogJHtwYXJhbXMucG9ydH1gKVxuICAgIH1cbiAgICBpZiAoIWlzQm9vbGVhbihwYXJhbXMudXNlU1NMKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgYEludmFsaWQgdXNlU1NMIGZsYWcgdHlwZSA6ICR7cGFyYW1zLnVzZVNTTH0sIGV4cGVjdGVkIHRvIGJlIG9mIHR5cGUgXCJib29sZWFuXCJgLFxuICAgICAgKVxuICAgIH1cblxuICAgIC8vIFZhbGlkYXRlIHJlZ2lvbiBvbmx5IGlmIGl0cyBzZXQuXG4gICAgaWYgKHBhcmFtcy5yZWdpb24pIHtcbiAgICAgIGlmICghaXNTdHJpbmcocGFyYW1zLnJlZ2lvbikpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCByZWdpb24gOiAke3BhcmFtcy5yZWdpb259YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBob3N0ID0gcGFyYW1zLmVuZFBvaW50LnRvTG93ZXJDYXNlKClcbiAgICBsZXQgcG9ydCA9IHBhcmFtcy5wb3J0XG4gICAgbGV0IHByb3RvY29sOiBzdHJpbmdcbiAgICBsZXQgdHJhbnNwb3J0XG4gICAgbGV0IHRyYW5zcG9ydEFnZW50OiBodHRwLkFnZW50XG4gICAgLy8gVmFsaWRhdGUgaWYgY29uZmlndXJhdGlvbiBpcyBub3QgdXNpbmcgU1NMXG4gICAgLy8gZm9yIGNvbnN0cnVjdGluZyByZWxldmFudCBlbmRwb2ludHMuXG4gICAgaWYgKHBhcmFtcy51c2VTU0wpIHtcbiAgICAgIC8vIERlZmF1bHRzIHRvIHNlY3VyZS5cbiAgICAgIHRyYW5zcG9ydCA9IGh0dHBzXG4gICAgICBwcm90b2NvbCA9ICdodHRwczonXG4gICAgICBwb3J0ID0gcG9ydCB8fCA0NDNcbiAgICAgIHRyYW5zcG9ydEFnZW50ID0gaHR0cHMuZ2xvYmFsQWdlbnRcbiAgICB9IGVsc2Uge1xuICAgICAgdHJhbnNwb3J0ID0gaHR0cFxuICAgICAgcHJvdG9jb2wgPSAnaHR0cDonXG4gICAgICBwb3J0ID0gcG9ydCB8fCA4MFxuICAgICAgdHJhbnNwb3J0QWdlbnQgPSBodHRwLmdsb2JhbEFnZW50XG4gICAgfVxuXG4gICAgLy8gaWYgY3VzdG9tIHRyYW5zcG9ydCBpcyBzZXQsIHVzZSBpdC5cbiAgICBpZiAocGFyYW1zLnRyYW5zcG9ydCkge1xuICAgICAgaWYgKCFpc09iamVjdChwYXJhbXMudHJhbnNwb3J0KSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgIGBJbnZhbGlkIHRyYW5zcG9ydCB0eXBlIDogJHtwYXJhbXMudHJhbnNwb3J0fSwgZXhwZWN0ZWQgdG8gYmUgdHlwZSBcIm9iamVjdFwiYCxcbiAgICAgICAgKVxuICAgICAgfVxuICAgICAgdHJhbnNwb3J0ID0gcGFyYW1zLnRyYW5zcG9ydFxuICAgIH1cblxuICAgIC8vIGlmIGN1c3RvbSB0cmFuc3BvcnQgYWdlbnQgaXMgc2V0LCB1c2UgaXQuXG4gICAgaWYgKHBhcmFtcy50cmFuc3BvcnRBZ2VudCkge1xuICAgICAgaWYgKCFpc09iamVjdChwYXJhbXMudHJhbnNwb3J0QWdlbnQpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgYEludmFsaWQgdHJhbnNwb3J0QWdlbnQgdHlwZTogJHtwYXJhbXMudHJhbnNwb3J0QWdlbnR9LCBleHBlY3RlZCB0byBiZSB0eXBlIFwib2JqZWN0XCJgLFxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIHRyYW5zcG9ydEFnZW50ID0gcGFyYW1zLnRyYW5zcG9ydEFnZW50XG4gICAgfVxuXG4gICAgLy8gVXNlciBBZ2VudCBzaG91bGQgYWx3YXlzIGZvbGxvd2luZyB0aGUgYmVsb3cgc3R5bGUuXG4gICAgLy8gUGxlYXNlIG9wZW4gYW4gaXNzdWUgdG8gZGlzY3VzcyBhbnkgbmV3IGNoYW5nZXMgaGVyZS5cbiAgICAvL1xuICAgIC8vICAgICAgIE1pbklPIChPUzsgQVJDSCkgTElCL1ZFUiBBUFAvVkVSXG4gICAgLy9cbiAgICBjb25zdCBsaWJyYXJ5Q29tbWVudHMgPSBgKCR7cHJvY2Vzcy5wbGF0Zm9ybX07ICR7cHJvY2Vzcy5hcmNofSlgXG4gICAgY29uc3QgbGlicmFyeUFnZW50ID0gYE1pbklPICR7bGlicmFyeUNvbW1lbnRzfSBtaW5pby1qcy8ke1BhY2thZ2UudmVyc2lvbn1gXG4gICAgLy8gVXNlciBhZ2VudCBibG9jayBlbmRzLlxuXG4gICAgdGhpcy50cmFuc3BvcnQgPSB0cmFuc3BvcnRcbiAgICB0aGlzLnRyYW5zcG9ydEFnZW50ID0gdHJhbnNwb3J0QWdlbnRcbiAgICB0aGlzLmhvc3QgPSBob3N0XG4gICAgdGhpcy5wb3J0ID0gcG9ydFxuICAgIHRoaXMucHJvdG9jb2wgPSBwcm90b2NvbFxuICAgIHRoaXMudXNlckFnZW50ID0gYCR7bGlicmFyeUFnZW50fWBcblxuICAgIC8vIERlZmF1bHQgcGF0aCBzdHlsZSBpcyB0cnVlXG4gICAgaWYgKHBhcmFtcy5wYXRoU3R5bGUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5wYXRoU3R5bGUgPSB0cnVlXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucGF0aFN0eWxlID0gcGFyYW1zLnBhdGhTdHlsZVxuICAgIH1cblxuICAgIHRoaXMuYWNjZXNzS2V5ID0gcGFyYW1zLmFjY2Vzc0tleSA/PyAnJ1xuICAgIHRoaXMuc2VjcmV0S2V5ID0gcGFyYW1zLnNlY3JldEtleSA/PyAnJ1xuICAgIHRoaXMuc2Vzc2lvblRva2VuID0gcGFyYW1zLnNlc3Npb25Ub2tlblxuICAgIHRoaXMuYW5vbnltb3VzID0gIXRoaXMuYWNjZXNzS2V5IHx8ICF0aGlzLnNlY3JldEtleVxuXG4gICAgaWYgKHBhcmFtcy5jcmVkZW50aWFsc1Byb3ZpZGVyKSB7XG4gICAgICB0aGlzLmNyZWRlbnRpYWxzUHJvdmlkZXIgPSBwYXJhbXMuY3JlZGVudGlhbHNQcm92aWRlclxuICAgIH1cblxuICAgIHRoaXMucmVnaW9uTWFwID0ge31cbiAgICBpZiAocGFyYW1zLnJlZ2lvbikge1xuICAgICAgdGhpcy5yZWdpb24gPSBwYXJhbXMucmVnaW9uXG4gICAgfVxuXG4gICAgaWYgKHBhcmFtcy5wYXJ0U2l6ZSkge1xuICAgICAgdGhpcy5wYXJ0U2l6ZSA9IHBhcmFtcy5wYXJ0U2l6ZVxuICAgICAgdGhpcy5vdmVyUmlkZVBhcnRTaXplID0gdHJ1ZVxuICAgIH1cbiAgICBpZiAodGhpcy5wYXJ0U2l6ZSA8IDUgKiAxMDI0ICogMTAyNCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgUGFydCBzaXplIHNob3VsZCBiZSBncmVhdGVyIHRoYW4gNU1CYClcbiAgICB9XG4gICAgaWYgKHRoaXMucGFydFNpemUgPiA1ICogMTAyNCAqIDEwMjQgKiAxMDI0KSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBQYXJ0IHNpemUgc2hvdWxkIGJlIGxlc3MgdGhhbiA1R0JgKVxuICAgIH1cblxuICAgIC8vIFNIQTI1NiBpcyBlbmFibGVkIG9ubHkgZm9yIGF1dGhlbnRpY2F0ZWQgaHR0cCByZXF1ZXN0cy4gSWYgdGhlIHJlcXVlc3QgaXMgYXV0aGVudGljYXRlZFxuICAgIC8vIGFuZCB0aGUgY29ubmVjdGlvbiBpcyBodHRwcyB3ZSB1c2UgeC1hbXotY29udGVudC1zaGEyNTY9VU5TSUdORUQtUEFZTE9BRFxuICAgIC8vIGhlYWRlciBmb3Igc2lnbmF0dXJlIGNhbGN1bGF0aW9uLlxuICAgIHRoaXMuZW5hYmxlU0hBMjU2ID0gIXRoaXMuYW5vbnltb3VzICYmICFwYXJhbXMudXNlU1NMXG5cbiAgICB0aGlzLnMzQWNjZWxlcmF0ZUVuZHBvaW50ID0gcGFyYW1zLnMzQWNjZWxlcmF0ZUVuZHBvaW50IHx8IHVuZGVmaW5lZFxuICAgIHRoaXMucmVxT3B0aW9ucyA9IHt9XG4gICAgdGhpcy5jbGllbnRFeHRlbnNpb25zID0gbmV3IEV4dGVuc2lvbnModGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBNaW5pbyBleHRlbnNpb25zIHRoYXQgYXJlbid0IG5lY2Vzc2FyeSBwcmVzZW50IGZvciBBbWF6b24gUzMgY29tcGF0aWJsZSBzdG9yYWdlIHNlcnZlcnNcbiAgICovXG4gIGdldCBleHRlbnNpb25zKCkge1xuICAgIHJldHVybiB0aGlzLmNsaWVudEV4dGVuc2lvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBAcGFyYW0gZW5kUG9pbnQgLSB2YWxpZCBTMyBhY2NlbGVyYXRpb24gZW5kIHBvaW50XG4gICAqL1xuICBzZXRTM1RyYW5zZmVyQWNjZWxlcmF0ZShlbmRQb2ludDogc3RyaW5nKSB7XG4gICAgdGhpcy5zM0FjY2VsZXJhdGVFbmRwb2ludCA9IGVuZFBvaW50XG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgc3VwcG9ydGVkIHJlcXVlc3Qgb3B0aW9ucy5cbiAgICovXG4gIHB1YmxpYyBzZXRSZXF1ZXN0T3B0aW9ucyhvcHRpb25zOiBQaWNrPGh0dHBzLlJlcXVlc3RPcHRpb25zLCAodHlwZW9mIHJlcXVlc3RPcHRpb25Qcm9wZXJ0aWVzKVtudW1iZXJdPikge1xuICAgIGlmICghaXNPYmplY3Qob3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlcXVlc3Qgb3B0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgdGhpcy5yZXFPcHRpb25zID0gXy5waWNrKG9wdGlvbnMsIHJlcXVlc3RPcHRpb25Qcm9wZXJ0aWVzKVxuICB9XG5cbiAgLyoqXG4gICAqICBUaGlzIGlzIHMzIFNwZWNpZmljIGFuZCBkb2VzIG5vdCBob2xkIHZhbGlkaXR5IGluIGFueSBvdGhlciBPYmplY3Qgc3RvcmFnZS5cbiAgICovXG4gIHByaXZhdGUgZ2V0QWNjZWxlcmF0ZUVuZFBvaW50SWZTZXQoYnVja2V0TmFtZT86IHN0cmluZywgb2JqZWN0TmFtZT86IHN0cmluZykge1xuICAgIGlmICghaXNFbXB0eSh0aGlzLnMzQWNjZWxlcmF0ZUVuZHBvaW50KSAmJiAhaXNFbXB0eShidWNrZXROYW1lKSAmJiAhaXNFbXB0eShvYmplY3ROYW1lKSkge1xuICAgICAgLy8gaHR0cDovL2RvY3MuYXdzLmFtYXpvbi5jb20vQW1hem9uUzMvbGF0ZXN0L2Rldi90cmFuc2Zlci1hY2NlbGVyYXRpb24uaHRtbFxuICAgICAgLy8gRGlzYWJsZSB0cmFuc2ZlciBhY2NlbGVyYXRpb24gZm9yIG5vbi1jb21wbGlhbnQgYnVja2V0IG5hbWVzLlxuICAgICAgaWYgKGJ1Y2tldE5hbWUuaW5jbHVkZXMoJy4nKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRyYW5zZmVyIEFjY2VsZXJhdGlvbiBpcyBub3Qgc3VwcG9ydGVkIGZvciBub24gY29tcGxpYW50IGJ1Y2tldDoke2J1Y2tldE5hbWV9YClcbiAgICAgIH1cbiAgICAgIC8vIElmIHRyYW5zZmVyIGFjY2VsZXJhdGlvbiBpcyByZXF1ZXN0ZWQgc2V0IG5ldyBob3N0LlxuICAgICAgLy8gRm9yIG1vcmUgZGV0YWlscyBhYm91dCBlbmFibGluZyB0cmFuc2ZlciBhY2NlbGVyYXRpb24gcmVhZCBoZXJlLlxuICAgICAgLy8gaHR0cDovL2RvY3MuYXdzLmFtYXpvbi5jb20vQW1hem9uUzMvbGF0ZXN0L2Rldi90cmFuc2Zlci1hY2NlbGVyYXRpb24uaHRtbFxuICAgICAgcmV0dXJuIHRoaXMuczNBY2NlbGVyYXRlRW5kcG9pbnRcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogcmV0dXJucyBvcHRpb25zIG9iamVjdCB0aGF0IGNhbiBiZSB1c2VkIHdpdGggaHR0cC5yZXF1ZXN0KClcbiAgICogVGFrZXMgY2FyZSBvZiBjb25zdHJ1Y3RpbmcgdmlydHVhbC1ob3N0LXN0eWxlIG9yIHBhdGgtc3R5bGUgaG9zdG5hbWVcbiAgICovXG4gIHByb3RlY3RlZCBnZXRSZXF1ZXN0T3B0aW9ucyhcbiAgICBvcHRzOiBSZXF1ZXN0T3B0aW9uICYgeyByZWdpb246IHN0cmluZyB9LFxuICApOiBJUmVxdWVzdCAmIHsgaG9zdDogc3RyaW5nOyBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IH0ge1xuICAgIGNvbnN0IG1ldGhvZCA9IG9wdHMubWV0aG9kXG4gICAgY29uc3QgcmVnaW9uID0gb3B0cy5yZWdpb25cbiAgICBjb25zdCBidWNrZXROYW1lID0gb3B0cy5idWNrZXROYW1lXG4gICAgbGV0IG9iamVjdE5hbWUgPSBvcHRzLm9iamVjdE5hbWVcbiAgICBjb25zdCBoZWFkZXJzID0gb3B0cy5oZWFkZXJzXG4gICAgY29uc3QgcXVlcnkgPSBvcHRzLnF1ZXJ5XG5cbiAgICBsZXQgcmVxT3B0aW9ucyA9IHtcbiAgICAgIG1ldGhvZCxcbiAgICAgIGhlYWRlcnM6IHt9IGFzIFJlcXVlc3RIZWFkZXJzLFxuICAgICAgcHJvdG9jb2w6IHRoaXMucHJvdG9jb2wsXG4gICAgICAvLyBJZiBjdXN0b20gdHJhbnNwb3J0QWdlbnQgd2FzIHN1cHBsaWVkIGVhcmxpZXIsIHdlJ2xsIGluamVjdCBpdCBoZXJlXG4gICAgICBhZ2VudDogdGhpcy50cmFuc3BvcnRBZ2VudCxcbiAgICB9XG5cbiAgICAvLyBWZXJpZnkgaWYgdmlydHVhbCBob3N0IHN1cHBvcnRlZC5cbiAgICBsZXQgdmlydHVhbEhvc3RTdHlsZVxuICAgIGlmIChidWNrZXROYW1lKSB7XG4gICAgICB2aXJ0dWFsSG9zdFN0eWxlID0gaXNWaXJ0dWFsSG9zdFN0eWxlKHRoaXMuaG9zdCwgdGhpcy5wcm90b2NvbCwgYnVja2V0TmFtZSwgdGhpcy5wYXRoU3R5bGUpXG4gICAgfVxuXG4gICAgbGV0IHBhdGggPSAnLydcbiAgICBsZXQgaG9zdCA9IHRoaXMuaG9zdFxuXG4gICAgbGV0IHBvcnQ6IHVuZGVmaW5lZCB8IG51bWJlclxuICAgIGlmICh0aGlzLnBvcnQpIHtcbiAgICAgIHBvcnQgPSB0aGlzLnBvcnRcbiAgICB9XG5cbiAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgb2JqZWN0TmFtZSA9IHVyaVJlc291cmNlRXNjYXBlKG9iamVjdE5hbWUpXG4gICAgfVxuXG4gICAgLy8gRm9yIEFtYXpvbiBTMyBlbmRwb2ludCwgZ2V0IGVuZHBvaW50IGJhc2VkIG9uIHJlZ2lvbi5cbiAgICBpZiAoaXNBbWF6b25FbmRwb2ludChob3N0KSkge1xuICAgICAgY29uc3QgYWNjZWxlcmF0ZUVuZFBvaW50ID0gdGhpcy5nZXRBY2NlbGVyYXRlRW5kUG9pbnRJZlNldChidWNrZXROYW1lLCBvYmplY3ROYW1lKVxuICAgICAgaWYgKGFjY2VsZXJhdGVFbmRQb2ludCkge1xuICAgICAgICBob3N0ID0gYCR7YWNjZWxlcmF0ZUVuZFBvaW50fWBcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGhvc3QgPSBnZXRTM0VuZHBvaW50KHJlZ2lvbilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodmlydHVhbEhvc3RTdHlsZSAmJiAhb3B0cy5wYXRoU3R5bGUpIHtcbiAgICAgIC8vIEZvciBhbGwgaG9zdHMgd2hpY2ggc3VwcG9ydCB2aXJ0dWFsIGhvc3Qgc3R5bGUsIGBidWNrZXROYW1lYFxuICAgICAgLy8gaXMgcGFydCBvZiB0aGUgaG9zdG5hbWUgaW4gdGhlIGZvbGxvd2luZyBmb3JtYXQ6XG4gICAgICAvL1xuICAgICAgLy8gIHZhciBob3N0ID0gJ2J1Y2tldE5hbWUuZXhhbXBsZS5jb20nXG4gICAgICAvL1xuICAgICAgaWYgKGJ1Y2tldE5hbWUpIHtcbiAgICAgICAgaG9zdCA9IGAke2J1Y2tldE5hbWV9LiR7aG9zdH1gXG4gICAgICB9XG4gICAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgICBwYXRoID0gYC8ke29iamVjdE5hbWV9YFxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBGb3IgYWxsIFMzIGNvbXBhdGlibGUgc3RvcmFnZSBzZXJ2aWNlcyB3ZSB3aWxsIGZhbGxiYWNrIHRvXG4gICAgICAvLyBwYXRoIHN0eWxlIHJlcXVlc3RzLCB3aGVyZSBgYnVja2V0TmFtZWAgaXMgcGFydCBvZiB0aGUgVVJJXG4gICAgICAvLyBwYXRoLlxuICAgICAgaWYgKGJ1Y2tldE5hbWUpIHtcbiAgICAgICAgcGF0aCA9IGAvJHtidWNrZXROYW1lfWBcbiAgICAgIH1cbiAgICAgIGlmIChvYmplY3ROYW1lKSB7XG4gICAgICAgIHBhdGggPSBgLyR7YnVja2V0TmFtZX0vJHtvYmplY3ROYW1lfWBcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocXVlcnkpIHtcbiAgICAgIHBhdGggKz0gYD8ke3F1ZXJ5fWBcbiAgICB9XG4gICAgcmVxT3B0aW9ucy5oZWFkZXJzLmhvc3QgPSBob3N0XG4gICAgaWYgKChyZXFPcHRpb25zLnByb3RvY29sID09PSAnaHR0cDonICYmIHBvcnQgIT09IDgwKSB8fCAocmVxT3B0aW9ucy5wcm90b2NvbCA9PT0gJ2h0dHBzOicgJiYgcG9ydCAhPT0gNDQzKSkge1xuICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzLmhvc3QgPSBgJHtob3N0fToke3BvcnR9YFxuICAgIH1cbiAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3VzZXItYWdlbnQnXSA9IHRoaXMudXNlckFnZW50XG4gICAgaWYgKGhlYWRlcnMpIHtcbiAgICAgIC8vIGhhdmUgYWxsIGhlYWRlciBrZXlzIGluIGxvd2VyIGNhc2UgLSB0byBtYWtlIHNpZ25pbmcgZWFzeVxuICAgICAgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMoaGVhZGVycykpIHtcbiAgICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzW2sudG9Mb3dlckNhc2UoKV0gPSB2XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gVXNlIGFueSByZXF1ZXN0IG9wdGlvbiBzcGVjaWZpZWQgaW4gbWluaW9DbGllbnQuc2V0UmVxdWVzdE9wdGlvbnMoKVxuICAgIHJlcU9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLnJlcU9wdGlvbnMsIHJlcU9wdGlvbnMpXG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4ucmVxT3B0aW9ucyxcbiAgICAgIGhlYWRlcnM6IF8ubWFwVmFsdWVzKF8ucGlja0J5KHJlcU9wdGlvbnMuaGVhZGVycywgaXNEZWZpbmVkKSwgKHYpID0+IHYudG9TdHJpbmcoKSksXG4gICAgICBob3N0LFxuICAgICAgcG9ydCxcbiAgICAgIHBhdGgsXG4gICAgfSBzYXRpc2ZpZXMgaHR0cHMuUmVxdWVzdE9wdGlvbnNcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBzZXRDcmVkZW50aWFsc1Byb3ZpZGVyKGNyZWRlbnRpYWxzUHJvdmlkZXI6IENyZWRlbnRpYWxQcm92aWRlcikge1xuICAgIGlmICghKGNyZWRlbnRpYWxzUHJvdmlkZXIgaW5zdGFuY2VvZiBDcmVkZW50aWFsUHJvdmlkZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuYWJsZSB0byBnZXQgY3JlZGVudGlhbHMuIEV4cGVjdGVkIGluc3RhbmNlIG9mIENyZWRlbnRpYWxQcm92aWRlcicpXG4gICAgfVxuICAgIHRoaXMuY3JlZGVudGlhbHNQcm92aWRlciA9IGNyZWRlbnRpYWxzUHJvdmlkZXJcbiAgICBhd2FpdCB0aGlzLmNoZWNrQW5kUmVmcmVzaENyZWRzKClcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKSB7XG4gICAgaWYgKHRoaXMuY3JlZGVudGlhbHNQcm92aWRlcikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY3JlZGVudGlhbHNDb25mID0gYXdhaXQgdGhpcy5jcmVkZW50aWFsc1Byb3ZpZGVyLmdldENyZWRlbnRpYWxzKClcbiAgICAgICAgdGhpcy5hY2Nlc3NLZXkgPSBjcmVkZW50aWFsc0NvbmYuZ2V0QWNjZXNzS2V5KClcbiAgICAgICAgdGhpcy5zZWNyZXRLZXkgPSBjcmVkZW50aWFsc0NvbmYuZ2V0U2VjcmV0S2V5KClcbiAgICAgICAgdGhpcy5zZXNzaW9uVG9rZW4gPSBjcmVkZW50aWFsc0NvbmYuZ2V0U2Vzc2lvblRva2VuKClcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZ2V0IGNyZWRlbnRpYWxzOiAke2V9YCwgeyBjYXVzZTogZSB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgbG9nU3RyZWFtPzogc3RyZWFtLldyaXRhYmxlXG5cbiAgLyoqXG4gICAqIGxvZyB0aGUgcmVxdWVzdCwgcmVzcG9uc2UsIGVycm9yXG4gICAqL1xuICBwcml2YXRlIGxvZ0hUVFAocmVxT3B0aW9uczogSVJlcXVlc3QsIHJlc3BvbnNlOiBodHRwLkluY29taW5nTWVzc2FnZSB8IG51bGwsIGVycj86IHVua25vd24pIHtcbiAgICAvLyBpZiBubyBsb2dTdHJlYW0gYXZhaWxhYmxlIHJldHVybi5cbiAgICBpZiAoIXRoaXMubG9nU3RyZWFtKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChyZXFPcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxT3B0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKHJlc3BvbnNlICYmICFpc1JlYWRhYmxlU3RyZWFtKHJlc3BvbnNlKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVzcG9uc2Ugc2hvdWxkIGJlIG9mIHR5cGUgXCJTdHJlYW1cIicpXG4gICAgfVxuICAgIGlmIChlcnIgJiYgIShlcnIgaW5zdGFuY2VvZiBFcnJvcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2VyciBzaG91bGQgYmUgb2YgdHlwZSBcIkVycm9yXCInKVxuICAgIH1cbiAgICBjb25zdCBsb2dTdHJlYW0gPSB0aGlzLmxvZ1N0cmVhbVxuICAgIGNvbnN0IGxvZ0hlYWRlcnMgPSAoaGVhZGVyczogUmVxdWVzdEhlYWRlcnMpID0+IHtcbiAgICAgIE9iamVjdC5lbnRyaWVzKGhlYWRlcnMpLmZvckVhY2goKFtrLCB2XSkgPT4ge1xuICAgICAgICBpZiAoayA9PSAnYXV0aG9yaXphdGlvbicpIHtcbiAgICAgICAgICBpZiAoaXNTdHJpbmcodikpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlZGFjdG9yID0gbmV3IFJlZ0V4cCgnU2lnbmF0dXJlPShbMC05YS1mXSspJylcbiAgICAgICAgICAgIHYgPSB2LnJlcGxhY2UocmVkYWN0b3IsICdTaWduYXR1cmU9KipSRURBQ1RFRCoqJylcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgbG9nU3RyZWFtLndyaXRlKGAke2t9OiAke3Z9XFxuYClcbiAgICAgIH0pXG4gICAgICBsb2dTdHJlYW0ud3JpdGUoJ1xcbicpXG4gICAgfVxuICAgIGxvZ1N0cmVhbS53cml0ZShgUkVRVUVTVDogJHtyZXFPcHRpb25zLm1ldGhvZH0gJHtyZXFPcHRpb25zLnBhdGh9XFxuYClcbiAgICBsb2dIZWFkZXJzKHJlcU9wdGlvbnMuaGVhZGVycylcbiAgICBpZiAocmVzcG9uc2UpIHtcbiAgICAgIHRoaXMubG9nU3RyZWFtLndyaXRlKGBSRVNQT05TRTogJHtyZXNwb25zZS5zdGF0dXNDb2RlfVxcbmApXG4gICAgICBsb2dIZWFkZXJzKHJlc3BvbnNlLmhlYWRlcnMgYXMgUmVxdWVzdEhlYWRlcnMpXG4gICAgfVxuICAgIGlmIChlcnIpIHtcbiAgICAgIGxvZ1N0cmVhbS53cml0ZSgnRVJST1IgQk9EWTpcXG4nKVxuICAgICAgY29uc3QgZXJySlNPTiA9IEpTT04uc3RyaW5naWZ5KGVyciwgbnVsbCwgJ1xcdCcpXG4gICAgICBsb2dTdHJlYW0ud3JpdGUoYCR7ZXJySlNPTn1cXG5gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbmFibGUgdHJhY2luZ1xuICAgKi9cbiAgcHVibGljIHRyYWNlT24oc3RyZWFtPzogc3RyZWFtLldyaXRhYmxlKSB7XG4gICAgaWYgKCFzdHJlYW0pIHtcbiAgICAgIHN0cmVhbSA9IHByb2Nlc3Muc3Rkb3V0XG4gICAgfVxuICAgIHRoaXMubG9nU3RyZWFtID0gc3RyZWFtXG4gIH1cblxuICAvKipcbiAgICogRGlzYWJsZSB0cmFjaW5nXG4gICAqL1xuICBwdWJsaWMgdHJhY2VPZmYoKSB7XG4gICAgdGhpcy5sb2dTdHJlYW0gPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBtYWtlUmVxdWVzdCBpcyB0aGUgcHJpbWl0aXZlIHVzZWQgYnkgdGhlIGFwaXMgZm9yIG1ha2luZyBTMyByZXF1ZXN0cy5cbiAgICogcGF5bG9hZCBjYW4gYmUgZW1wdHkgc3RyaW5nIGluIGNhc2Ugb2Ygbm8gcGF5bG9hZC5cbiAgICogc3RhdHVzQ29kZSBpcyB0aGUgZXhwZWN0ZWQgc3RhdHVzQ29kZS4gSWYgcmVzcG9uc2Uuc3RhdHVzQ29kZSBkb2VzIG5vdCBtYXRjaFxuICAgKiB3ZSBwYXJzZSB0aGUgWE1MIGVycm9yIGFuZCBjYWxsIHRoZSBjYWxsYmFjayB3aXRoIHRoZSBlcnJvciBtZXNzYWdlLlxuICAgKlxuICAgKiBBIHZhbGlkIHJlZ2lvbiBpcyBwYXNzZWQgYnkgdGhlIGNhbGxzIC0gbGlzdEJ1Y2tldHMsIG1ha2VCdWNrZXQgYW5kIGdldEJ1Y2tldFJlZ2lvbi5cbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuICBhc3luYyBtYWtlUmVxdWVzdEFzeW5jKFxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXG4gICAgcGF5bG9hZDogQmluYXJ5ID0gJycsXG4gICAgZXhwZWN0ZWRDb2RlczogbnVtYmVyW10gPSBbMjAwXSxcbiAgICByZWdpb24gPSAnJyxcbiAgKTogUHJvbWlzZTxodHRwLkluY29taW5nTWVzc2FnZT4ge1xuICAgIGlmICghaXNPYmplY3Qob3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocGF5bG9hZCkgJiYgIWlzT2JqZWN0KHBheWxvYWQpKSB7XG4gICAgICAvLyBCdWZmZXIgaXMgb2YgdHlwZSAnb2JqZWN0J1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncGF5bG9hZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiIG9yIFwiQnVmZmVyXCInKVxuICAgIH1cbiAgICBleHBlY3RlZENvZGVzLmZvckVhY2goKHN0YXR1c0NvZGUpID0+IHtcbiAgICAgIGlmICghaXNOdW1iZXIoc3RhdHVzQ29kZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc3RhdHVzQ29kZSBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICAgIH1cbiAgICB9KVxuICAgIGlmICghaXNTdHJpbmcocmVnaW9uKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVnaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIW9wdGlvbnMuaGVhZGVycykge1xuICAgICAgb3B0aW9ucy5oZWFkZXJzID0ge31cbiAgICB9XG4gICAgaWYgKG9wdGlvbnMubWV0aG9kID09PSAnUE9TVCcgfHwgb3B0aW9ucy5tZXRob2QgPT09ICdQVVQnIHx8IG9wdGlvbnMubWV0aG9kID09PSAnREVMRVRFJykge1xuICAgICAgb3B0aW9ucy5oZWFkZXJzWydjb250ZW50LWxlbmd0aCddID0gcGF5bG9hZC5sZW5ndGgudG9TdHJpbmcoKVxuICAgIH1cbiAgICBjb25zdCBzaGEyNTZzdW0gPSB0aGlzLmVuYWJsZVNIQTI1NiA/IHRvU2hhMjU2KHBheWxvYWQpIDogJydcbiAgICByZXR1cm4gdGhpcy5tYWtlUmVxdWVzdFN0cmVhbUFzeW5jKG9wdGlvbnMsIHBheWxvYWQsIHNoYTI1NnN1bSwgZXhwZWN0ZWRDb2RlcywgcmVnaW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIG5ldyByZXF1ZXN0IHdpdGggcHJvbWlzZVxuICAgKlxuICAgKiBObyBuZWVkIHRvIGRyYWluIHJlc3BvbnNlLCByZXNwb25zZSBib2R5IGlzIG5vdCB2YWxpZFxuICAgKi9cbiAgYXN5bmMgbWFrZVJlcXVlc3RBc3luY09taXQoXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBwYXlsb2FkOiBCaW5hcnkgPSAnJyxcbiAgICBzdGF0dXNDb2RlczogbnVtYmVyW10gPSBbMjAwXSxcbiAgICByZWdpb24gPSAnJyxcbiAgKTogUHJvbWlzZTxPbWl0PGh0dHAuSW5jb21pbmdNZXNzYWdlLCAnb24nPj4ge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhvcHRpb25zLCBwYXlsb2FkLCBzdGF0dXNDb2RlcywgcmVnaW9uKVxuICAgIGF3YWl0IGRyYWluUmVzcG9uc2UocmVzKVxuICAgIHJldHVybiByZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBtYWtlUmVxdWVzdFN0cmVhbSB3aWxsIGJlIHVzZWQgZGlyZWN0bHkgaW5zdGVhZCBvZiBtYWtlUmVxdWVzdCBpbiBjYXNlIHRoZSBwYXlsb2FkXG4gICAqIGlzIGF2YWlsYWJsZSBhcyBhIHN0cmVhbS4gZm9yIGV4LiBwdXRPYmplY3RcbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuICBhc3luYyBtYWtlUmVxdWVzdFN0cmVhbUFzeW5jKFxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXG4gICAgYm9keTogc3RyZWFtLlJlYWRhYmxlIHwgQmluYXJ5LFxuICAgIHNoYTI1NnN1bTogc3RyaW5nLFxuICAgIHN0YXR1c0NvZGVzOiBudW1iZXJbXSxcbiAgICByZWdpb246IHN0cmluZyxcbiAgKTogUHJvbWlzZTxodHRwLkluY29taW5nTWVzc2FnZT4ge1xuICAgIGlmICghaXNPYmplY3Qob3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmICghKEJ1ZmZlci5pc0J1ZmZlcihib2R5KSB8fCB0eXBlb2YgYm9keSA9PT0gJ3N0cmluZycgfHwgaXNSZWFkYWJsZVN0cmVhbShib2R5KSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgIGBzdHJlYW0gc2hvdWxkIGJlIGEgQnVmZmVyLCBzdHJpbmcgb3IgcmVhZGFibGUgU3RyZWFtLCBnb3QgJHt0eXBlb2YgYm9keX0gaW5zdGVhZGAsXG4gICAgICApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoc2hhMjU2c3VtKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc2hhMjU2c3VtIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBzdGF0dXNDb2Rlcy5mb3JFYWNoKChzdGF0dXNDb2RlKSA9PiB7XG4gICAgICBpZiAoIWlzTnVtYmVyKHN0YXR1c0NvZGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0YXR1c0NvZGUgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgICB9XG4gICAgfSlcbiAgICBpZiAoIWlzU3RyaW5nKHJlZ2lvbikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlZ2lvbiBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgLy8gc2hhMjU2c3VtIHdpbGwgYmUgZW1wdHkgZm9yIGFub255bW91cyBvciBodHRwcyByZXF1ZXN0c1xuICAgIGlmICghdGhpcy5lbmFibGVTSEEyNTYgJiYgc2hhMjU2c3VtLmxlbmd0aCAhPT0gMCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgc2hhMjU2c3VtIGV4cGVjdGVkIHRvIGJlIGVtcHR5IGZvciBhbm9ueW1vdXMgb3IgaHR0cHMgcmVxdWVzdHNgKVxuICAgIH1cbiAgICAvLyBzaGEyNTZzdW0gc2hvdWxkIGJlIHZhbGlkIGZvciBub24tYW5vbnltb3VzIGh0dHAgcmVxdWVzdHMuXG4gICAgaWYgKHRoaXMuZW5hYmxlU0hBMjU2ICYmIHNoYTI1NnN1bS5sZW5ndGggIT09IDY0KSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHNoYTI1NnN1bSA6ICR7c2hhMjU2c3VtfWApXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5jaGVja0FuZFJlZnJlc2hDcmVkcygpXG5cbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5vbi1udWxsLWFzc2VydGlvblxuICAgIHJlZ2lvbiA9IHJlZ2lvbiB8fCAoYXdhaXQgdGhpcy5nZXRCdWNrZXRSZWdpb25Bc3luYyhvcHRpb25zLmJ1Y2tldE5hbWUhKSlcblxuICAgIGNvbnN0IHJlcU9wdGlvbnMgPSB0aGlzLmdldFJlcXVlc3RPcHRpb25zKHsgLi4ub3B0aW9ucywgcmVnaW9uIH0pXG4gICAgaWYgKCF0aGlzLmFub255bW91cykge1xuICAgICAgLy8gRm9yIG5vbi1hbm9ueW1vdXMgaHR0cHMgcmVxdWVzdHMgc2hhMjU2c3VtIGlzICdVTlNJR05FRC1QQVlMT0FEJyBmb3Igc2lnbmF0dXJlIGNhbGN1bGF0aW9uLlxuICAgICAgaWYgKCF0aGlzLmVuYWJsZVNIQTI1Nikge1xuICAgICAgICBzaGEyNTZzdW0gPSAnVU5TSUdORUQtUEFZTE9BRCdcbiAgICAgIH1cbiAgICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSgpXG4gICAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3gtYW16LWRhdGUnXSA9IG1ha2VEYXRlTG9uZyhkYXRlKVxuICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzWyd4LWFtei1jb250ZW50LXNoYTI1NiddID0gc2hhMjU2c3VtXG4gICAgICBpZiAodGhpcy5zZXNzaW9uVG9rZW4pIHtcbiAgICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzWyd4LWFtei1zZWN1cml0eS10b2tlbiddID0gdGhpcy5zZXNzaW9uVG9rZW5cbiAgICAgIH1cbiAgICAgIHJlcU9wdGlvbnMuaGVhZGVycy5hdXRob3JpemF0aW9uID0gc2lnblY0KHJlcU9wdGlvbnMsIHRoaXMuYWNjZXNzS2V5LCB0aGlzLnNlY3JldEtleSwgcmVnaW9uLCBkYXRlLCBzaGEyNTZzdW0pXG4gICAgfVxuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0KHRoaXMudHJhbnNwb3J0LCByZXFPcHRpb25zLCBib2R5KVxuICAgIGlmICghcmVzcG9uc2Uuc3RhdHVzQ29kZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQlVHOiByZXNwb25zZSBkb2Vzbid0IGhhdmUgYSBzdGF0dXNDb2RlXCIpXG4gICAgfVxuXG4gICAgaWYgKCFzdGF0dXNDb2Rlcy5pbmNsdWRlcyhyZXNwb25zZS5zdGF0dXNDb2RlKSkge1xuICAgICAgLy8gRm9yIGFuIGluY29ycmVjdCByZWdpb24sIFMzIHNlcnZlciBhbHdheXMgc2VuZHMgYmFjayA0MDAuXG4gICAgICAvLyBCdXQgd2Ugd2lsbCBkbyBjYWNoZSBpbnZhbGlkYXRpb24gZm9yIGFsbCBlcnJvcnMgc28gdGhhdCxcbiAgICAgIC8vIGluIGZ1dHVyZSwgaWYgQVdTIFMzIGRlY2lkZXMgdG8gc2VuZCBhIGRpZmZlcmVudCBzdGF0dXMgY29kZSBvclxuICAgICAgLy8gWE1MIGVycm9yIGNvZGUgd2Ugd2lsbCBzdGlsbCB3b3JrIGZpbmUuXG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5vbi1udWxsLWFzc2VydGlvblxuICAgICAgZGVsZXRlIHRoaXMucmVnaW9uTWFwW29wdGlvbnMuYnVja2V0TmFtZSFdXG5cbiAgICAgIGNvbnN0IGVyciA9IGF3YWl0IHhtbFBhcnNlcnMucGFyc2VSZXNwb25zZUVycm9yKHJlc3BvbnNlKVxuICAgICAgdGhpcy5sb2dIVFRQKHJlcU9wdGlvbnMsIHJlc3BvbnNlLCBlcnIpXG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG5cbiAgICB0aGlzLmxvZ0hUVFAocmVxT3B0aW9ucywgcmVzcG9uc2UpXG5cbiAgICByZXR1cm4gcmVzcG9uc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBnZXRzIHRoZSByZWdpb24gb2YgdGhlIGJ1Y2tldFxuICAgKlxuICAgKiBAcGFyYW0gYnVja2V0TmFtZVxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHByb3RlY3RlZCBhc3luYyBnZXRCdWNrZXRSZWdpb25Bc3luYyhidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZSA6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cblxuICAgIC8vIFJlZ2lvbiBpcyBzZXQgd2l0aCBjb25zdHJ1Y3RvciwgcmV0dXJuIHRoZSByZWdpb24gcmlnaHQgaGVyZS5cbiAgICBpZiAodGhpcy5yZWdpb24pIHtcbiAgICAgIHJldHVybiB0aGlzLnJlZ2lvblxuICAgIH1cblxuICAgIGNvbnN0IGNhY2hlZCA9IHRoaXMucmVnaW9uTWFwW2J1Y2tldE5hbWVdXG4gICAgaWYgKGNhY2hlZCkge1xuICAgICAgcmV0dXJuIGNhY2hlZFxuICAgIH1cblxuICAgIGNvbnN0IGV4dHJhY3RSZWdpb25Bc3luYyA9IGFzeW5jIChyZXNwb25zZTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpID0+IHtcbiAgICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXG4gICAgICBjb25zdCByZWdpb24gPSB4bWxQYXJzZXJzLnBhcnNlQnVja2V0UmVnaW9uKGJvZHkpIHx8IERFRkFVTFRfUkVHSU9OXG4gICAgICB0aGlzLnJlZ2lvbk1hcFtidWNrZXROYW1lXSA9IHJlZ2lvblxuICAgICAgcmV0dXJuIHJlZ2lvblxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAnbG9jYXRpb24nXG4gICAgLy8gYGdldEJ1Y2tldExvY2F0aW9uYCBiZWhhdmVzIGRpZmZlcmVudGx5IGluIGZvbGxvd2luZyB3YXlzIGZvclxuICAgIC8vIGRpZmZlcmVudCBlbnZpcm9ubWVudHMuXG4gICAgLy9cbiAgICAvLyAtIEZvciBub2RlanMgZW52IHdlIGRlZmF1bHQgdG8gcGF0aCBzdHlsZSByZXF1ZXN0cy5cbiAgICAvLyAtIEZvciBicm93c2VyIGVudiBwYXRoIHN0eWxlIHJlcXVlc3RzIG9uIGJ1Y2tldHMgeWllbGRzIENPUlNcbiAgICAvLyAgIGVycm9yLiBUbyBjaXJjdW12ZW50IHRoaXMgcHJvYmxlbSB3ZSBtYWtlIGEgdmlydHVhbCBob3N0XG4gICAgLy8gICBzdHlsZSByZXF1ZXN0IHNpZ25lZCB3aXRoICd1cy1lYXN0LTEnLiBUaGlzIHJlcXVlc3QgZmFpbHNcbiAgICAvLyAgIHdpdGggYW4gZXJyb3IgJ0F1dGhvcml6YXRpb25IZWFkZXJNYWxmb3JtZWQnLCBhZGRpdGlvbmFsbHlcbiAgICAvLyAgIHRoZSBlcnJvciBYTUwgYWxzbyBwcm92aWRlcyBSZWdpb24gb2YgdGhlIGJ1Y2tldC4gVG8gdmFsaWRhdGVcbiAgICAvLyAgIHRoaXMgcmVnaW9uIGlzIHByb3BlciB3ZSByZXRyeSB0aGUgc2FtZSByZXF1ZXN0IHdpdGggdGhlIG5ld2x5XG4gICAgLy8gICBvYnRhaW5lZCByZWdpb24uXG4gICAgY29uc3QgcGF0aFN0eWxlID0gdGhpcy5wYXRoU3R5bGUgJiYgIWlzQnJvd3NlclxuICAgIGxldCByZWdpb246IHN0cmluZ1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBwYXRoU3R5bGUgfSwgJycsIFsyMDBdLCBERUZBVUxUX1JFR0lPTilcbiAgICAgIHJldHVybiBleHRyYWN0UmVnaW9uQXN5bmMocmVzKVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIGlmICghKGUubmFtZSA9PT0gJ0F1dGhvcml6YXRpb25IZWFkZXJNYWxmb3JtZWQnKSkge1xuICAgICAgICB0aHJvdyBlXG4gICAgICB9XG4gICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIHdlIHNldCBleHRyYSBwcm9wZXJ0aWVzIG9uIGVycm9yIG9iamVjdFxuICAgICAgcmVnaW9uID0gZS5SZWdpb24gYXMgc3RyaW5nXG4gICAgICBpZiAoIXJlZ2lvbikge1xuICAgICAgICB0aHJvdyBlXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgcGF0aFN0eWxlIH0sICcnLCBbMjAwXSwgcmVnaW9uKVxuICAgIHJldHVybiBhd2FpdCBleHRyYWN0UmVnaW9uQXN5bmMocmVzKVxuICB9XG5cbiAgLyoqXG4gICAqIG1ha2VSZXF1ZXN0IGlzIHRoZSBwcmltaXRpdmUgdXNlZCBieSB0aGUgYXBpcyBmb3IgbWFraW5nIFMzIHJlcXVlc3RzLlxuICAgKiBwYXlsb2FkIGNhbiBiZSBlbXB0eSBzdHJpbmcgaW4gY2FzZSBvZiBubyBwYXlsb2FkLlxuICAgKiBzdGF0dXNDb2RlIGlzIHRoZSBleHBlY3RlZCBzdGF0dXNDb2RlLiBJZiByZXNwb25zZS5zdGF0dXNDb2RlIGRvZXMgbm90IG1hdGNoXG4gICAqIHdlIHBhcnNlIHRoZSBYTUwgZXJyb3IgYW5kIGNhbGwgdGhlIGNhbGxiYWNrIHdpdGggdGhlIGVycm9yIG1lc3NhZ2UuXG4gICAqIEEgdmFsaWQgcmVnaW9uIGlzIHBhc3NlZCBieSB0aGUgY2FsbHMgLSBsaXN0QnVja2V0cywgbWFrZUJ1Y2tldCBhbmRcbiAgICogZ2V0QnVja2V0UmVnaW9uLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCB1c2UgYG1ha2VSZXF1ZXN0QXN5bmNgIGluc3RlYWRcbiAgICovXG4gIG1ha2VSZXF1ZXN0KFxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXG4gICAgcGF5bG9hZDogQmluYXJ5ID0gJycsXG4gICAgZXhwZWN0ZWRDb2RlczogbnVtYmVyW10gPSBbMjAwXSxcbiAgICByZWdpb24gPSAnJyxcbiAgICByZXR1cm5SZXNwb25zZTogYm9vbGVhbixcbiAgICBjYjogKGNiOiB1bmtub3duLCByZXN1bHQ6IGh0dHAuSW5jb21pbmdNZXNzYWdlKSA9PiB2b2lkLFxuICApIHtcbiAgICBsZXQgcHJvbTogUHJvbWlzZTxodHRwLkluY29taW5nTWVzc2FnZT5cbiAgICBpZiAocmV0dXJuUmVzcG9uc2UpIHtcbiAgICAgIHByb20gPSB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMob3B0aW9ucywgcGF5bG9hZCwgZXhwZWN0ZWRDb2RlcywgcmVnaW9uKVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGNvbXBhdGlibGUgZm9yIG9sZCBiZWhhdmlvdXJcbiAgICAgIHByb20gPSB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KG9wdGlvbnMsIHBheWxvYWQsIGV4cGVjdGVkQ29kZXMsIHJlZ2lvbilcbiAgICB9XG5cbiAgICBwcm9tLnRoZW4oXG4gICAgICAocmVzdWx0KSA9PiBjYihudWxsLCByZXN1bHQpLFxuICAgICAgKGVycikgPT4ge1xuICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgY2IoZXJyKVxuICAgICAgfSxcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogbWFrZVJlcXVlc3RTdHJlYW0gd2lsbCBiZSB1c2VkIGRpcmVjdGx5IGluc3RlYWQgb2YgbWFrZVJlcXVlc3QgaW4gY2FzZSB0aGUgcGF5bG9hZFxuICAgKiBpcyBhdmFpbGFibGUgYXMgYSBzdHJlYW0uIGZvciBleC4gcHV0T2JqZWN0XG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBgbWFrZVJlcXVlc3RTdHJlYW1Bc3luY2AgaW5zdGVhZFxuICAgKi9cbiAgbWFrZVJlcXVlc3RTdHJlYW0oXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBzdHJlYW06IHN0cmVhbS5SZWFkYWJsZSB8IEJ1ZmZlcixcbiAgICBzaGEyNTZzdW06IHN0cmluZyxcbiAgICBzdGF0dXNDb2RlczogbnVtYmVyW10sXG4gICAgcmVnaW9uOiBzdHJpbmcsXG4gICAgcmV0dXJuUmVzcG9uc2U6IGJvb2xlYW4sXG4gICAgY2I6IChjYjogdW5rbm93biwgcmVzdWx0OiBodHRwLkluY29taW5nTWVzc2FnZSkgPT4gdm9pZCxcbiAgKSB7XG4gICAgY29uc3QgZXhlY3V0b3IgPSBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMob3B0aW9ucywgc3RyZWFtLCBzaGEyNTZzdW0sIHN0YXR1c0NvZGVzLCByZWdpb24pXG4gICAgICBpZiAoIXJldHVyblJlc3BvbnNlKSB7XG4gICAgICAgIGF3YWl0IGRyYWluUmVzcG9uc2UocmVzKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzXG4gICAgfVxuXG4gICAgZXhlY3V0b3IoKS50aGVuKFxuICAgICAgKHJlc3VsdCkgPT4gY2IobnVsbCwgcmVzdWx0KSxcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIChlcnIpID0+IGNiKGVyciksXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBgZ2V0QnVja2V0UmVnaW9uQXN5bmNgIGluc3RlYWRcbiAgICovXG4gIGdldEJ1Y2tldFJlZ2lvbihidWNrZXROYW1lOiBzdHJpbmcsIGNiOiAoZXJyOiB1bmtub3duLCByZWdpb246IHN0cmluZykgPT4gdm9pZCkge1xuICAgIHJldHVybiB0aGlzLmdldEJ1Y2tldFJlZ2lvbkFzeW5jKGJ1Y2tldE5hbWUpLnRoZW4oXG4gICAgICAocmVzdWx0KSA9PiBjYihudWxsLCByZXN1bHQpLFxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgKGVycikgPT4gY2IoZXJyKSxcbiAgICApXG4gIH1cblxuICBhc3luYyByZW1vdmVCdWNrZXQoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPlxuXG4gIC8qKlxuICAgKiBAZGVwcmVjYXRlZCB1c2UgcHJvbWlzZSBzdHlsZSBBUElcbiAgICovXG4gIHJlbW92ZUJ1Y2tldChidWNrZXROYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiBOb1Jlc3VsdENhbGxiYWNrKTogdm9pZFxuXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldChidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUgfSwgJycsIFsyMDRdKVxuICAgIGRlbGV0ZSB0aGlzLnJlZ2lvbk1hcFtidWNrZXROYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXQgaW5mb3JtYXRpb24gb2YgdGhlIG9iamVjdC5cbiAgICovXG4gIGFzeW5jIHN0YXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHN0YXRPcHRzOiBTdGF0T2JqZWN0T3B0cyA9IHt9KTogUHJvbWlzZTxCdWNrZXRJdGVtU3RhdD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKCFpc09iamVjdChzdGF0T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3N0YXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5ID0gcXMuc3RyaW5naWZ5KHN0YXRPcHRzKVxuICAgIGNvbnN0IG1ldGhvZCA9ICdIRUFEJ1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0pXG5cbiAgICByZXR1cm4ge1xuICAgICAgc2l6ZTogcGFyc2VJbnQocmVzLmhlYWRlcnNbJ2NvbnRlbnQtbGVuZ3RoJ10gYXMgc3RyaW5nKSxcbiAgICAgIG1ldGFEYXRhOiBleHRyYWN0TWV0YWRhdGEocmVzLmhlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxuICAgICAgbGFzdE1vZGlmaWVkOiBuZXcgRGF0ZShyZXMuaGVhZGVyc1snbGFzdC1tb2RpZmllZCddIGFzIHN0cmluZyksXG4gICAgICB2ZXJzaW9uSWQ6IGdldFZlcnNpb25JZChyZXMuaGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgICBldGFnOiBzYW5pdGl6ZUVUYWcocmVzLmhlYWRlcnMuZXRhZyksXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZSB0aGUgc3BlY2lmaWVkIG9iamVjdC5cbiAgICogQGRlcHJlY2F0ZWQgdXNlIG5ldyBwcm9taXNlIHN0eWxlIEFQSVxuICAgKi9cbiAgcmVtb3ZlT2JqZWN0KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCByZW1vdmVPcHRzOiBSZW1vdmVPcHRpb25zLCBjYWxsYmFjazogTm9SZXN1bHRDYWxsYmFjayk6IHZvaWRcbiAgLyoqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBuZXcgcHJvbWlzZSBzdHlsZSBBUElcbiAgICovXG4gIC8vIEB0cy1pZ25vcmVcbiAgcmVtb3ZlT2JqZWN0KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBjYWxsYmFjazogTm9SZXN1bHRDYWxsYmFjayk6IHZvaWRcbiAgYXN5bmMgcmVtb3ZlT2JqZWN0KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCByZW1vdmVPcHRzPzogUmVtb3ZlT3B0aW9ucyk6IFByb21pc2U8dm9pZD5cblxuICBhc3luYyByZW1vdmVPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHJlbW92ZU9wdHM6IFJlbW92ZU9wdGlvbnMgPSB7fSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKCFpc09iamVjdChyZW1vdmVPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmVtb3ZlT3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxuICAgIGlmIChyZW1vdmVPcHRzLmdvdmVybmFuY2VCeXBhc3MpIHtcbiAgICAgIGhlYWRlcnNbJ1gtQW16LUJ5cGFzcy1Hb3Zlcm5hbmNlLVJldGVudGlvbiddID0gdHJ1ZVxuICAgIH1cbiAgICBpZiAocmVtb3ZlT3B0cy5mb3JjZURlbGV0ZSkge1xuICAgICAgaGVhZGVyc1sneC1taW5pby1mb3JjZS1kZWxldGUnXSA9IHRydWVcbiAgICB9XG5cbiAgICBjb25zdCBxdWVyeVBhcmFtczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG4gICAgaWYgKHJlbW92ZU9wdHMudmVyc2lvbklkKSB7XG4gICAgICBxdWVyeVBhcmFtcy52ZXJzaW9uSWQgPSBgJHtyZW1vdmVPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuICAgIGNvbnN0IHF1ZXJ5ID0gcXMuc3RyaW5naWZ5KHF1ZXJ5UGFyYW1zKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycywgcXVlcnkgfSwgJycsIFsyMDAsIDIwNF0pXG4gIH1cblxuICAvLyBDYWxscyBpbXBsZW1lbnRlZCBiZWxvdyBhcmUgcmVsYXRlZCB0byBtdWx0aXBhcnQuXG5cbiAgLyoqXG4gICAqIEluaXRpYXRlIGEgbmV3IG11bHRpcGFydCB1cGxvYWQuXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgYXN5bmMgaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGhlYWRlcnMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoJ2NvbnRlbnRUeXBlIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnUE9TVCdcbiAgICBjb25zdCBxdWVyeSA9ICd1cGxvYWRzJ1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzQnVmZmVyKHJlcylcbiAgICByZXR1cm4gcGFyc2VJbml0aWF0ZU11bHRpcGFydChib2R5LnRvU3RyaW5nKCkpXG4gIH1cblxuICAvKipcbiAgICogSW50ZXJuYWwgTWV0aG9kIHRvIGFib3J0IGEgbXVsdGlwYXJ0IHVwbG9hZCByZXF1ZXN0IGluIGNhc2Ugb2YgYW55IGVycm9ycy5cbiAgICpcbiAgICogQHBhcmFtIGJ1Y2tldE5hbWUgLSBCdWNrZXQgTmFtZVxuICAgKiBAcGFyYW0gb2JqZWN0TmFtZSAtIE9iamVjdCBOYW1lXG4gICAqIEBwYXJhbSB1cGxvYWRJZCAtIGlkIG9mIGEgbXVsdGlwYXJ0IHVwbG9hZCB0byBjYW5jZWwgZHVyaW5nIGNvbXBvc2Ugb2JqZWN0IHNlcXVlbmNlLlxuICAgKi9cbiAgYXN5bmMgYWJvcnRNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHVwbG9hZElkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7dXBsb2FkSWR9YFxuXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZTogb2JqZWN0TmFtZSwgcXVlcnkgfVxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQocmVxdWVzdE9wdGlvbnMsICcnLCBbMjA0XSlcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgcGFydC1pbmZvIG9mIGFsbCBwYXJ0cyBvZiBhbiBpbmNvbXBsZXRlIHVwbG9hZCBzcGVjaWZpZWQgYnkgdXBsb2FkSWQuXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgbGlzdFBhcnRzKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCB1cGxvYWRJZDogc3RyaW5nKTogUHJvbWlzZTxVcGxvYWRlZFBhcnRbXT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcodXBsb2FkSWQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd1cGxvYWRJZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCF1cGxvYWRJZCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndXBsb2FkSWQgY2Fubm90IGJlIGVtcHR5JylcbiAgICB9XG5cbiAgICBjb25zdCBwYXJ0czogVXBsb2FkZWRQYXJ0W10gPSBbXVxuICAgIGxldCBtYXJrZXIgPSAwXG4gICAgbGV0IHJlc3VsdFxuICAgIGRvIHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMubGlzdFBhcnRzUXVlcnkoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdXBsb2FkSWQsIG1hcmtlcilcbiAgICAgIG1hcmtlciA9IHJlc3VsdC5tYXJrZXJcbiAgICAgIHBhcnRzLnB1c2goLi4ucmVzdWx0LnBhcnRzKVxuICAgIH0gd2hpbGUgKHJlc3VsdC5pc1RydW5jYXRlZClcblxuICAgIHJldHVybiBwYXJ0c1xuICB9XG5cbiAgLyoqXG4gICAqIENhbGxlZCBieSBsaXN0UGFydHMgdG8gZmV0Y2ggYSBiYXRjaCBvZiBwYXJ0LWluZm9cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgbGlzdFBhcnRzUXVlcnkoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHVwbG9hZElkOiBzdHJpbmcsIG1hcmtlcjogbnVtYmVyKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyh1cGxvYWRJZCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VwbG9hZElkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzTnVtYmVyKG1hcmtlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21hcmtlciBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG4gICAgaWYgKCF1cGxvYWRJZCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndXBsb2FkSWQgY2Fubm90IGJlIGVtcHR5JylcbiAgICB9XG5cbiAgICBsZXQgcXVlcnkgPSBgdXBsb2FkSWQ9JHt1cmlFc2NhcGUodXBsb2FkSWQpfWBcbiAgICBpZiAobWFya2VyKSB7XG4gICAgICBxdWVyeSArPSBgJnBhcnQtbnVtYmVyLW1hcmtlcj0ke21hcmtlcn1gXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0pXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VMaXN0UGFydHMoYXdhaXQgcmVhZEFzU3RyaW5nKHJlcykpXG4gIH1cblxuICBhc3luYyBsaXN0QnVja2V0cygpOiBQcm9taXNlPEJ1Y2tldEl0ZW1Gcm9tTGlzdFtdPiB7XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBodHRwUmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kIH0sICcnLCBbMjAwXSwgREVGQVVMVF9SRUdJT04pXG4gICAgY29uc3QgeG1sUmVzdWx0ID0gYXdhaXQgcmVhZEFzU3RyaW5nKGh0dHBSZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VMaXN0QnVja2V0KHhtbFJlc3VsdClcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD5cbiAgcmVtb3ZlQnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nLCBjYWxsYmFjazogTm9SZXN1bHRDYWxsYmFjayk6IHZvaWRcbiAgYXN5bmMgcmVtb3ZlQnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBjb25zdCBxdWVyeSA9ICdyZXBsaWNhdGlvbidcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMCwgMjA0XSwgJycpXG4gIH1cblxuICBzZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIHJlcGxpY2F0aW9uQ29uZmlnOiBSZXBsaWNhdGlvbkNvbmZpZ09wdHMsIGNhbGxiYWNrOiBOb1Jlc3VsdENhbGxiYWNrKTogdm9pZFxuICBhc3luYyBzZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIHJlcGxpY2F0aW9uQ29uZmlnOiBSZXBsaWNhdGlvbkNvbmZpZ09wdHMpOiBQcm9taXNlPHZvaWQ+XG4gIGFzeW5jIHNldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgcmVwbGljYXRpb25Db25maWc6IFJlcGxpY2F0aW9uQ29uZmlnT3B0cykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QocmVwbGljYXRpb25Db25maWcpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdyZXBsaWNhdGlvbkNvbmZpZyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKF8uaXNFbXB0eShyZXBsaWNhdGlvbkNvbmZpZy5yb2xlKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdSb2xlIGNhbm5vdCBiZSBlbXB0eScpXG4gICAgICB9IGVsc2UgaWYgKHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUgJiYgIWlzU3RyaW5nKHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0ludmFsaWQgdmFsdWUgZm9yIHJvbGUnLCByZXBsaWNhdGlvbkNvbmZpZy5yb2xlKVxuICAgICAgfVxuICAgICAgaWYgKF8uaXNFbXB0eShyZXBsaWNhdGlvbkNvbmZpZy5ydWxlcykpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignTWluaW11bSBvbmUgcmVwbGljYXRpb24gcnVsZSBtdXN0IGJlIHNwZWNpZmllZCcpXG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSAncmVwbGljYXRpb24nXG4gICAgY29uc3QgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG5cbiAgICBjb25zdCByZXBsaWNhdGlvblBhcmFtc0NvbmZpZyA9IHtcbiAgICAgIFJlcGxpY2F0aW9uQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBSb2xlOiByZXBsaWNhdGlvbkNvbmZpZy5yb2xlLFxuICAgICAgICBSdWxlOiByZXBsaWNhdGlvbkNvbmZpZy5ydWxlcyxcbiAgICAgIH0sXG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LCBoZWFkbGVzczogdHJ1ZSB9KVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHJlcGxpY2F0aW9uUGFyYW1zQ29uZmlnKVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQpXG4gIH1cblxuICBnZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiBSZXN1bHRDYWxsYmFjazxSZXBsaWNhdGlvbkNvbmZpZz4pOiB2b2lkXG4gIGFzeW5jIGdldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8UmVwbGljYXRpb25Db25maWc+XG4gIGFzeW5jIGdldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAncmVwbGljYXRpb24nXG5cbiAgICBjb25zdCBodHRwUmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMCwgMjA0XSlcbiAgICBjb25zdCB4bWxSZXN1bHQgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZVJlcGxpY2F0aW9uQ29uZmlnKHhtbFJlc3VsdClcbiAgfVxufVxuIl0sIm1hcHBpbmdzIjoiOzs7OztBQUFBLElBQUFBLElBQUEsR0FBQUMsdUJBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFDLEtBQUEsR0FBQUYsdUJBQUEsQ0FBQUMsT0FBQTtBQUdBLElBQUFFLGNBQUEsR0FBQUYsT0FBQTtBQUNBLElBQUFHLE9BQUEsR0FBQUgsT0FBQTtBQUNBLElBQUFJLEVBQUEsR0FBQUwsdUJBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFLLE9BQUEsR0FBQUwsT0FBQTtBQUVBLElBQUFNLG1CQUFBLEdBQUFOLE9BQUE7QUFDQSxJQUFBTyxNQUFBLEdBQUFSLHVCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBUSxRQUFBLEdBQUFSLE9BQUE7QUFDQSxJQUFBUyxRQUFBLEdBQUFULE9BQUE7QUFDQSxJQUFBVSxXQUFBLEdBQUFWLE9BQUE7QUFDQSxJQUFBVyxPQUFBLEdBQUFYLE9BQUE7QUF1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