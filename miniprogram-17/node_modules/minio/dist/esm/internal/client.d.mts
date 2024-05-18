/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import * as http from 'node:http';
import * as https from 'node:https';
import type * as stream from 'node:stream';
import { CredentialProvider } from "../CredentialProvider.mjs";
import { Extensions } from "./extensions.mjs";
import type { Region } from "./s3-endpoints.mjs";
import type { Binary, BucketItemFromList, BucketItemStat, IRequest, ReplicationConfig, ReplicationConfigOpts, RequestHeaders, ResultCallback, StatObjectOpts, Transport } from "./type.mjs";
import type { UploadedPart } from "./xml-parser.mjs";
declare const requestOptionProperties: readonly ["agent", "ca", "cert", "ciphers", "clientCertEngine", "crl", "dhparam", "ecdhCurve", "family", "honorCipherOrder", "key", "passphrase", "pfx", "rejectUnauthorized", "secureOptions", "secureProtocol", "servername", "sessionIdContext"];
export interface ClientOptions {
  endPoint: string;
  accessKey: string;
  secretKey: string;
  useSSL?: boolean;
  port?: number;
  region?: Region;
  transport?: Transport;
  sessionToken?: string;
  partSize?: number;
  pathStyle?: boolean;
  credentialsProvider?: CredentialProvider;
  s3AccelerateEndpoint?: string;
  transportAgent?: http.Agent;
}
export type RequestOption = Partial<IRequest> & {
  method: string;
  bucketName?: string;
  objectName?: string;
  query?: string;
  pathStyle?: boolean;
};
export type NoResultCallback = (error: unknown) => void;
export interface RemoveOptions {
  versionId?: string;
  governanceBypass?: boolean;
  forceDelete?: boolean;
}
export declare class TypedClient {
  protected transport: Transport;
  protected host: string;
  protected port: number;
  protected protocol: string;
  protected accessKey: string;
  protected secretKey: string;
  protected sessionToken?: string;
  protected userAgent: string;
  protected anonymous: boolean;
  protected pathStyle: boolean;
  protected regionMap: Record<string, string>;
  region?: string;
  protected credentialsProvider?: CredentialProvider;
  partSize: number;
  protected overRidePartSize?: boolean;
  protected maximumPartSize: number;
  protected maxObjectSize: number;
  enableSHA256: boolean;
  protected s3AccelerateEndpoint?: string;
  protected reqOptions: Record<string, unknown>;
  protected transportAgent: http.Agent;
  private readonly clientExtensions;
  constructor(params: ClientOptions);
  /**
   * Minio extensions that aren't necessary present for Amazon S3 compatible storage servers
   */
  get extensions(): Extensions;
  /**
   * @param endPoint - valid S3 acceleration end point
   */
  setS3TransferAccelerate(endPoint: string): void;
  /**
   * Sets the supported request options.
   */
  setRequestOptions(options: Pick<https.RequestOptions, (typeof requestOptionProperties)[number]>): void;
  /**
   *  This is s3 Specific and does not hold validity in any other Object storage.
   */
  private getAccelerateEndPointIfSet;
  /**
   * returns options object that can be used with http.request()
   * Takes care of constructing virtual-host-style or path-style hostname
   */
  protected getRequestOptions(opts: RequestOption & {
    region: string;
  }): IRequest & {
    host: string;
    headers: Record<string, string>;
  };
  setCredentialsProvider(credentialsProvider: CredentialProvider): Promise<void>;
  private checkAndRefreshCreds;
  private logStream?;
  /**
   * log the request, response, error
   */
  private logHTTP;
  /**
   * Enable tracing
   */
  traceOn(stream?: stream.Writable): void;
  /**
   * Disable tracing
   */
  traceOff(): void;
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
  makeRequestAsync(options: RequestOption, payload?: Binary, expectedCodes?: number[], region?: string): Promise<http.IncomingMessage>;
  /**
   * new request with promise
   *
   * No need to drain response, response body is not valid
   */
  makeRequestAsyncOmit(options: RequestOption, payload?: Binary, statusCodes?: number[], region?: string): Promise<Omit<http.IncomingMessage, 'on'>>;
  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @internal
   */
  makeRequestStreamAsync(options: RequestOption, body: stream.Readable | Binary, sha256sum: string, statusCodes: number[], region: string): Promise<http.IncomingMessage>;
  /**
   * gets the region of the bucket
   *
   * @param bucketName
   *
   * @internal
   */
  protected getBucketRegionAsync(bucketName: string): Promise<string>;
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
  makeRequest(options: RequestOption, payload: Binary | undefined, expectedCodes: number[] | undefined, region: string | undefined, returnResponse: boolean, cb: (cb: unknown, result: http.IncomingMessage) => void): void;
  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @deprecated use `makeRequestStreamAsync` instead
   */
  makeRequestStream(options: RequestOption, stream: stream.Readable | Buffer, sha256sum: string, statusCodes: number[], region: string, returnResponse: boolean, cb: (cb: unknown, result: http.IncomingMessage) => void): void;
  /**
   * @deprecated use `getBucketRegionAsync` instead
   */
  getBucketRegion(bucketName: string, cb: (err: unknown, region: string) => void): Promise<void>;
  removeBucket(bucketName: string): Promise<void>;
  /**
   * @deprecated use promise style API
   */
  removeBucket(bucketName: string, callback: NoResultCallback): void;
  /**
   * Stat information of the object.
   */
  statObject(bucketName: string, objectName: string, statOpts?: StatObjectOpts): Promise<BucketItemStat>;
  /**
   * Remove the specified object.
   * @deprecated use new promise style API
   */
  removeObject(bucketName: string, objectName: string, removeOpts: RemoveOptions, callback: NoResultCallback): void;
  /**
   * @deprecated use new promise style API
   */
  removeObject(bucketName: string, objectName: string, callback: NoResultCallback): void;
  removeObject(bucketName: string, objectName: string, removeOpts?: RemoveOptions): Promise<void>;
  /**
   * Initiate a new multipart upload.
   * @internal
   */
  initiateNewMultipartUpload(bucketName: string, objectName: string, headers: RequestHeaders): Promise<string>;
  /**
   * Internal Method to abort a multipart upload request in case of any errors.
   *
   * @param bucketName - Bucket Name
   * @param objectName - Object Name
   * @param uploadId - id of a multipart upload to cancel during compose object sequence.
   */
  abortMultipartUpload(bucketName: string, objectName: string, uploadId: string): Promise<void>;
  /**
   * Get part-info of all parts of an incomplete upload specified by uploadId.
   */
  protected listParts(bucketName: string, objectName: string, uploadId: string): Promise<UploadedPart[]>;
  /**
   * Called by listParts to fetch a batch of part-info
   */
  private listPartsQuery;
  listBuckets(): Promise<BucketItemFromList[]>;
  removeBucketReplication(bucketName: string): Promise<void>;
  removeBucketReplication(bucketName: string, callback: NoResultCallback): void;
  setBucketReplication(bucketName: string, replicationConfig: ReplicationConfigOpts, callback: NoResultCallback): void;
  setBucketReplication(bucketName: string, replicationConfig: ReplicationConfigOpts): Promise<void>;
  getBucketReplication(bucketName: string, callback: ResultCallback<ReplicationConfig>): void;
  getBucketReplication(bucketName: string): Promise<ReplicationConfig>;
}
export {};