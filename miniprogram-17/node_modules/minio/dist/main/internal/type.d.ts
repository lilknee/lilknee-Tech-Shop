/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import type * as http from 'node:http';
import type { Readable as ReadableStream } from 'node:stream';
export type Binary = string | Buffer;
export type ResponseHeader = Record<string, string>;
export type ObjectMetaData = Record<string, string | number>;
export type RequestHeaders = Record<string, string | boolean | number | undefined>;
export type Encryption = {
  type: ENCRYPTION_TYPES.SSEC;
} | {
  type: ENCRYPTION_TYPES.KMS;
  SSEAlgorithm?: string;
  KMSMasterKeyID?: string;
};
export declare enum ENCRYPTION_TYPES {
  /**
   * SSEC represents server-side-encryption with customer provided keys
   */
  SSEC = "SSE-C",
  /**
   * KMS represents server-side-encryption with managed keys
   */
  KMS = "KMS",
}
export declare enum RETENTION_MODES {
  GOVERNANCE = "GOVERNANCE",
  COMPLIANCE = "COMPLIANCE",
}
export declare enum RETENTION_VALIDITY_UNITS {
  DAYS = "Days",
  YEARS = "Years",
}
export declare enum LEGAL_HOLD_STATUS {
  ENABLED = "ON",
  DISABLED = "OFF",
}
export type Transport = Pick<typeof http, 'request'>;
export interface IRequest {
  protocol: string;
  port?: number | string;
  method: string;
  path: string;
  headers: RequestHeaders;
}
export type ICanonicalRequest = string;
export interface IncompleteUploadedBucketItem {
  key: string;
  uploadId: string;
  size: number;
}
export interface MetadataItem {
  Key: string;
  Value: string;
}
export interface ItemBucketMetadataList {
  Items: MetadataItem[];
}
export interface ItemBucketMetadata {
  [key: string]: any;
}
export interface BucketItemFromList {
  name: string;
  creationDate: Date;
}
export interface BucketItemCopy {
  etag: string;
  lastModified: Date;
}
export type BucketItem = {
  name: string;
  size: number;
  etag: string;
  prefix?: never;
  lastModified: Date;
} | {
  name?: never;
  etag?: never;
  lastModified?: never;
  prefix: string;
  size: 0;
};
export type BucketItemWithMetadata = BucketItem & {
  metadata?: ItemBucketMetadata | ItemBucketMetadataList;
};
export interface BucketStream<T> extends ReadableStream {
  on(event: 'data', listener: (item: T) => void): this;
  on(event: 'end' | 'pause' | 'readable' | 'resume' | 'close', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
}
export interface BucketItemStat {
  size: number;
  etag: string;
  lastModified: Date;
  metaData: ItemBucketMetadata;
  versionId?: string | null;
}
export type StatObjectOpts = {
  versionId?: string;
};
export type ReplicationRuleStatus = {
  Status: 'Enabled' | 'Disabled';
};
export type Tag = {
  Key: string;
  Value: string;
};
export type ReplicationRuleDestination = {
  Bucket: string;
  StorageClass: string;
};
export type ReplicationRuleAnd = {
  Prefix: string;
  Tags: Tag[];
};
export type ReplicationRuleFilter = {
  Prefix: string;
  And: ReplicationRuleAnd;
  Tag: Tag;
};
export type ReplicaModifications = {
  Status: ReplicationRuleStatus;
};
export type SourceSelectionCriteria = {
  ReplicaModifications: ReplicaModifications;
};
export type ExistingObjectReplication = {
  Status: ReplicationRuleStatus;
};
export type ReplicationRule = {
  ID: string;
  Status: ReplicationRuleStatus;
  Priority: number;
  DeleteMarkerReplication: ReplicationRuleStatus;
  DeleteReplication: ReplicationRuleStatus;
  Destination: ReplicationRuleDestination;
  Filter: ReplicationRuleFilter;
  SourceSelectionCriteria: SourceSelectionCriteria;
  ExistingObjectReplication: ExistingObjectReplication;
};
export type ReplicationConfigOpts = {
  role: string;
  rules: ReplicationRule[];
};
export type ReplicationConfig = {
  ReplicationConfiguration: ReplicationConfigOpts;
};
export type ResultCallback<T> = (error: Error | null, result: T) => void;