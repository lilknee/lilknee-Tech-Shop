/// <reference types="node" />
import type * as http from 'node:http';
import type { BucketItemFromList, BucketItemWithMetadata, ReplicationConfig } from "./type.mjs";
export declare function parseBucketRegion(xml: string): string;
export declare function parseError(xml: string, headerInfo: Record<string, unknown>): Record<string, unknown>;
export declare function parseResponseError(response: http.IncomingMessage): Promise<void>;
/**
 * parse XML response for list objects v2 with metadata in a bucket
 */
export declare function parseListObjectsV2WithMetadata(xml: string): {
  objects: Array<BucketItemWithMetadata>;
  isTruncated: boolean;
  nextContinuationToken: string;
};
export type Multipart = {
  uploads: Array<{
    key: string;
    uploadId: string;
    initiator: unknown;
    owner: unknown;
    storageClass: unknown;
    initiated: unknown;
  }>;
  prefixes: {
    prefix: string;
  }[];
  isTruncated: boolean;
  nextKeyMarker: undefined;
  nextUploadIdMarker: undefined;
};
export type UploadedPart = {
  part: number;
  lastModified?: Date;
  etag: string;
  size: number;
};
export declare function parseListParts(xml: string): {
  isTruncated: boolean;
  marker: number;
  parts: UploadedPart[];
};
export declare function parseListBucket(xml: string): BucketItemFromList[];
export declare function parseInitiateMultipart(xml: string): string;
export declare function parseReplicationConfig(xml: string): ReplicationConfig;