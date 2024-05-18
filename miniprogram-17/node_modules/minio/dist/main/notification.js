"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _events = require("events");
var _helpers = require("./helpers.js");
var _helper = require("./internal/helper.js");
var transformers = _interopRequireWildcard(require("./transformers.js"), true);
function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function (nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }
function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }
/*
 * MinIO Javascript Library for Amazon S3 Compatible Cloud Storage, (C) 2016 MinIO, Inc.
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

// Notification config - array of target configs.
// Target configs can be
// 1. Topic (simple notification service)
// 2. Queue (simple queue service)
// 3. CloudFront (lambda function)
class NotificationConfig {
  add(target) {
    let instance = '';
    if (target instanceof TopicConfig) {
      instance = 'TopicConfiguration';
    }
    if (target instanceof QueueConfig) {
      instance = 'QueueConfiguration';
    }
    if (target instanceof CloudFunctionConfig) {
      instance = 'CloudFunctionConfiguration';
    }
    if (!this[instance]) {
      this[instance] = [];
    }
    this[instance].push(target);
  }
}

// Base class for three supported configs.
exports.NotificationConfig = NotificationConfig;
class TargetConfig {
  setId(id) {
    this.Id = id;
  }
  addEvent(newevent) {
    if (!this.Event) {
      this.Event = [];
    }
    this.Event.push(newevent);
  }
  addFilterSuffix(suffix) {
    if (!this.Filter) {
      this.Filter = {
        S3Key: {
          FilterRule: []
        }
      };
    }
    this.Filter.S3Key.FilterRule.push({
      Name: 'suffix',
      Value: suffix
    });
  }
  addFilterPrefix(prefix) {
    if (!this.Filter) {
      this.Filter = {
        S3Key: {
          FilterRule: []
        }
      };
    }
    this.Filter.S3Key.FilterRule.push({
      Name: 'prefix',
      Value: prefix
    });
  }
}

// 1. Topic (simple notification service)
class TopicConfig extends TargetConfig {
  constructor(arn) {
    super();
    this.Topic = arn;
  }
}

// 2. Queue (simple queue service)
exports.TopicConfig = TopicConfig;
class QueueConfig extends TargetConfig {
  constructor(arn) {
    super();
    this.Queue = arn;
  }
}

// 3. CloudFront (lambda function)
exports.QueueConfig = QueueConfig;
class CloudFunctionConfig extends TargetConfig {
  constructor(arn) {
    super();
    this.CloudFunction = arn;
  }
}
exports.CloudFunctionConfig = CloudFunctionConfig;
const buildARN = (partition, service, region, accountId, resource) => {
  return 'arn:' + partition + ':' + service + ':' + region + ':' + accountId + ':' + resource;
};
exports.buildARN = buildARN;
const ObjectCreatedAll = 's3:ObjectCreated:*';
exports.ObjectCreatedAll = ObjectCreatedAll;
const ObjectCreatedPut = 's3:ObjectCreated:Put';
exports.ObjectCreatedPut = ObjectCreatedPut;
const ObjectCreatedPost = 's3:ObjectCreated:Post';
exports.ObjectCreatedPost = ObjectCreatedPost;
const ObjectCreatedCopy = 's3:ObjectCreated:Copy';
exports.ObjectCreatedCopy = ObjectCreatedCopy;
const ObjectCreatedCompleteMultipartUpload = 's3:ObjectCreated:CompleteMultipartUpload';
exports.ObjectCreatedCompleteMultipartUpload = ObjectCreatedCompleteMultipartUpload;
const ObjectRemovedAll = 's3:ObjectRemoved:*';
exports.ObjectRemovedAll = ObjectRemovedAll;
const ObjectRemovedDelete = 's3:ObjectRemoved:Delete';
exports.ObjectRemovedDelete = ObjectRemovedDelete;
const ObjectRemovedDeleteMarkerCreated = 's3:ObjectRemoved:DeleteMarkerCreated';
exports.ObjectRemovedDeleteMarkerCreated = ObjectRemovedDeleteMarkerCreated;
const ObjectReducedRedundancyLostObject = 's3:ReducedRedundancyLostObject';

// Poll for notifications, used in #listenBucketNotification.
// Listening constitutes repeatedly requesting s3 whether or not any
// changes have occurred.
exports.ObjectReducedRedundancyLostObject = ObjectReducedRedundancyLostObject;
class NotificationPoller extends _events.EventEmitter {
  constructor(client, bucketName, prefix, suffix, events) {
    super();
    this.client = client;
    this.bucketName = bucketName;
    this.prefix = prefix;
    this.suffix = suffix;
    this.events = events;
    this.ending = false;
  }

  // Starts the polling.
  start() {
    this.ending = false;
    process.nextTick(() => {
      this.checkForChanges();
    });
  }

  // Stops the polling.
  stop() {
    this.ending = true;
  }
  checkForChanges() {
    // Don't continue if we're looping again but are cancelled.
    if (this.ending) {
      return;
    }
    let method = 'GET';
    var queries = [];
    if (this.prefix) {
      var prefix = (0, _helper.uriEscape)(this.prefix);
      queries.push(`prefix=${prefix}`);
    }
    if (this.suffix) {
      var suffix = (0, _helper.uriEscape)(this.suffix);
      queries.push(`suffix=${suffix}`);
    }
    if (this.events) {
      this.events.forEach(s3event => queries.push('events=' + (0, _helper.uriEscape)(s3event)));
    }
    queries.sort();
    var query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    const region = this.client.region || _helpers.DEFAULT_REGION;
    this.client.makeRequest({
      method,
      bucketName: this.bucketName,
      query
    }, '', [200], region, true, (e, response) => {
      if (e) {
        return this.emit('error', e);
      }
      let transformer = transformers.getNotificationTransformer();
      (0, _helper.pipesetup)(response, transformer).on('data', result => {
        // Data is flushed periodically (every 5 seconds), so we should
        // handle it after flushing from the JSON parser.
        let records = result.Records;
        // If null (= no records), change to an empty array.
        if (!records) {
          records = [];
        }

        // Iterate over the notifications and emit them individually.
        records.forEach(record => {
          this.emit('notification', record);
        });

        // If we're done, stop.
        if (this.ending) {
          response.destroy();
        }
      }).on('error', e => this.emit('error', e)).on('end', () => {
        // Do it again, if we haven't cancelled yet.
        process.nextTick(() => {
          this.checkForChanges();
        });
      });
    });
  }
}
exports.NotificationPoller = NotificationPoller;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfZXZlbnRzIiwicmVxdWlyZSIsIl9oZWxwZXJzIiwiX2hlbHBlciIsInRyYW5zZm9ybWVycyIsIl9pbnRlcm9wUmVxdWlyZVdpbGRjYXJkIiwiX2dldFJlcXVpcmVXaWxkY2FyZENhY2hlIiwibm9kZUludGVyb3AiLCJXZWFrTWFwIiwiY2FjaGVCYWJlbEludGVyb3AiLCJjYWNoZU5vZGVJbnRlcm9wIiwib2JqIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJjYWNoZSIsImhhcyIsImdldCIsIm5ld09iaiIsImhhc1Byb3BlcnR5RGVzY3JpcHRvciIsIk9iamVjdCIsImRlZmluZVByb3BlcnR5IiwiZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yIiwia2V5IiwicHJvdG90eXBlIiwiaGFzT3duUHJvcGVydHkiLCJjYWxsIiwiZGVzYyIsInNldCIsIk5vdGlmaWNhdGlvbkNvbmZpZyIsImFkZCIsInRhcmdldCIsImluc3RhbmNlIiwiVG9waWNDb25maWciLCJRdWV1ZUNvbmZpZyIsIkNsb3VkRnVuY3Rpb25Db25maWciLCJwdXNoIiwiZXhwb3J0cyIsIlRhcmdldENvbmZpZyIsInNldElkIiwiaWQiLCJJZCIsImFkZEV2ZW50IiwibmV3ZXZlbnQiLCJFdmVudCIsImFkZEZpbHRlclN1ZmZpeCIsInN1ZmZpeCIsIkZpbHRlciIsIlMzS2V5IiwiRmlsdGVyUnVsZSIsIk5hbWUiLCJWYWx1ZSIsImFkZEZpbHRlclByZWZpeCIsInByZWZpeCIsImNvbnN0cnVjdG9yIiwiYXJuIiwiVG9waWMiLCJRdWV1ZSIsIkNsb3VkRnVuY3Rpb24iLCJidWlsZEFSTiIsInBhcnRpdGlvbiIsInNlcnZpY2UiLCJyZWdpb24iLCJhY2NvdW50SWQiLCJyZXNvdXJjZSIsIk9iamVjdENyZWF0ZWRBbGwiLCJPYmplY3RDcmVhdGVkUHV0IiwiT2JqZWN0Q3JlYXRlZFBvc3QiLCJPYmplY3RDcmVhdGVkQ29weSIsIk9iamVjdENyZWF0ZWRDb21wbGV0ZU11bHRpcGFydFVwbG9hZCIsIk9iamVjdFJlbW92ZWRBbGwiLCJPYmplY3RSZW1vdmVkRGVsZXRlIiwiT2JqZWN0UmVtb3ZlZERlbGV0ZU1hcmtlckNyZWF0ZWQiLCJPYmplY3RSZWR1Y2VkUmVkdW5kYW5jeUxvc3RPYmplY3QiLCJOb3RpZmljYXRpb25Qb2xsZXIiLCJFdmVudEVtaXR0ZXIiLCJjbGllbnQiLCJidWNrZXROYW1lIiwiZXZlbnRzIiwiZW5kaW5nIiwic3RhcnQiLCJwcm9jZXNzIiwibmV4dFRpY2siLCJjaGVja0ZvckNoYW5nZXMiLCJzdG9wIiwibWV0aG9kIiwicXVlcmllcyIsInVyaUVzY2FwZSIsImZvckVhY2giLCJzM2V2ZW50Iiwic29ydCIsInF1ZXJ5IiwibGVuZ3RoIiwiam9pbiIsIkRFRkFVTFRfUkVHSU9OIiwibWFrZVJlcXVlc3QiLCJlIiwicmVzcG9uc2UiLCJlbWl0IiwidHJhbnNmb3JtZXIiLCJnZXROb3RpZmljYXRpb25UcmFuc2Zvcm1lciIsInBpcGVzZXR1cCIsIm9uIiwicmVzdWx0IiwicmVjb3JkcyIsIlJlY29yZHMiLCJyZWNvcmQiLCJkZXN0cm95Il0sInNvdXJjZXMiOlsibm90aWZpY2F0aW9uLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gKiBNaW5JTyBKYXZhc2NyaXB0IExpYnJhcnkgZm9yIEFtYXpvbiBTMyBDb21wYXRpYmxlIENsb3VkIFN0b3JhZ2UsIChDKSAyMDE2IE1pbklPLCBJbmMuXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICovXG5cbmltcG9ydCB7IEV2ZW50RW1pdHRlciB9IGZyb20gJ25vZGU6ZXZlbnRzJ1xuXG5pbXBvcnQgeyBERUZBVUxUX1JFR0lPTiB9IGZyb20gJy4vaGVscGVycy50cydcbmltcG9ydCB7IHBpcGVzZXR1cCwgdXJpRXNjYXBlIH0gZnJvbSAnLi9pbnRlcm5hbC9oZWxwZXIudHMnXG5pbXBvcnQgKiBhcyB0cmFuc2Zvcm1lcnMgZnJvbSAnLi90cmFuc2Zvcm1lcnMuanMnXG5cbi8vIE5vdGlmaWNhdGlvbiBjb25maWcgLSBhcnJheSBvZiB0YXJnZXQgY29uZmlncy5cbi8vIFRhcmdldCBjb25maWdzIGNhbiBiZVxuLy8gMS4gVG9waWMgKHNpbXBsZSBub3RpZmljYXRpb24gc2VydmljZSlcbi8vIDIuIFF1ZXVlIChzaW1wbGUgcXVldWUgc2VydmljZSlcbi8vIDMuIENsb3VkRnJvbnQgKGxhbWJkYSBmdW5jdGlvbilcbmV4cG9ydCBjbGFzcyBOb3RpZmljYXRpb25Db25maWcge1xuICBhZGQodGFyZ2V0KSB7XG4gICAgbGV0IGluc3RhbmNlID0gJydcbiAgICBpZiAodGFyZ2V0IGluc3RhbmNlb2YgVG9waWNDb25maWcpIHtcbiAgICAgIGluc3RhbmNlID0gJ1RvcGljQ29uZmlndXJhdGlvbidcbiAgICB9XG4gICAgaWYgKHRhcmdldCBpbnN0YW5jZW9mIFF1ZXVlQ29uZmlnKSB7XG4gICAgICBpbnN0YW5jZSA9ICdRdWV1ZUNvbmZpZ3VyYXRpb24nXG4gICAgfVxuICAgIGlmICh0YXJnZXQgaW5zdGFuY2VvZiBDbG91ZEZ1bmN0aW9uQ29uZmlnKSB7XG4gICAgICBpbnN0YW5jZSA9ICdDbG91ZEZ1bmN0aW9uQ29uZmlndXJhdGlvbidcbiAgICB9XG4gICAgaWYgKCF0aGlzW2luc3RhbmNlXSkge1xuICAgICAgdGhpc1tpbnN0YW5jZV0gPSBbXVxuICAgIH1cbiAgICB0aGlzW2luc3RhbmNlXS5wdXNoKHRhcmdldClcbiAgfVxufVxuXG4vLyBCYXNlIGNsYXNzIGZvciB0aHJlZSBzdXBwb3J0ZWQgY29uZmlncy5cbmNsYXNzIFRhcmdldENvbmZpZyB7XG4gIHNldElkKGlkKSB7XG4gICAgdGhpcy5JZCA9IGlkXG4gIH1cbiAgYWRkRXZlbnQobmV3ZXZlbnQpIHtcbiAgICBpZiAoIXRoaXMuRXZlbnQpIHtcbiAgICAgIHRoaXMuRXZlbnQgPSBbXVxuICAgIH1cbiAgICB0aGlzLkV2ZW50LnB1c2gobmV3ZXZlbnQpXG4gIH1cbiAgYWRkRmlsdGVyU3VmZml4KHN1ZmZpeCkge1xuICAgIGlmICghdGhpcy5GaWx0ZXIpIHtcbiAgICAgIHRoaXMuRmlsdGVyID0geyBTM0tleTogeyBGaWx0ZXJSdWxlOiBbXSB9IH1cbiAgICB9XG4gICAgdGhpcy5GaWx0ZXIuUzNLZXkuRmlsdGVyUnVsZS5wdXNoKHsgTmFtZTogJ3N1ZmZpeCcsIFZhbHVlOiBzdWZmaXggfSlcbiAgfVxuICBhZGRGaWx0ZXJQcmVmaXgocHJlZml4KSB7XG4gICAgaWYgKCF0aGlzLkZpbHRlcikge1xuICAgICAgdGhpcy5GaWx0ZXIgPSB7IFMzS2V5OiB7IEZpbHRlclJ1bGU6IFtdIH0gfVxuICAgIH1cbiAgICB0aGlzLkZpbHRlci5TM0tleS5GaWx0ZXJSdWxlLnB1c2goeyBOYW1lOiAncHJlZml4JywgVmFsdWU6IHByZWZpeCB9KVxuICB9XG59XG5cbi8vIDEuIFRvcGljIChzaW1wbGUgbm90aWZpY2F0aW9uIHNlcnZpY2UpXG5leHBvcnQgY2xhc3MgVG9waWNDb25maWcgZXh0ZW5kcyBUYXJnZXRDb25maWcge1xuICBjb25zdHJ1Y3Rvcihhcm4pIHtcbiAgICBzdXBlcigpXG4gICAgdGhpcy5Ub3BpYyA9IGFyblxuICB9XG59XG5cbi8vIDIuIFF1ZXVlIChzaW1wbGUgcXVldWUgc2VydmljZSlcbmV4cG9ydCBjbGFzcyBRdWV1ZUNvbmZpZyBleHRlbmRzIFRhcmdldENvbmZpZyB7XG4gIGNvbnN0cnVjdG9yKGFybikge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLlF1ZXVlID0gYXJuXG4gIH1cbn1cblxuLy8gMy4gQ2xvdWRGcm9udCAobGFtYmRhIGZ1bmN0aW9uKVxuZXhwb3J0IGNsYXNzIENsb3VkRnVuY3Rpb25Db25maWcgZXh0ZW5kcyBUYXJnZXRDb25maWcge1xuICBjb25zdHJ1Y3Rvcihhcm4pIHtcbiAgICBzdXBlcigpXG4gICAgdGhpcy5DbG91ZEZ1bmN0aW9uID0gYXJuXG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IGJ1aWxkQVJOID0gKHBhcnRpdGlvbiwgc2VydmljZSwgcmVnaW9uLCBhY2NvdW50SWQsIHJlc291cmNlKSA9PiB7XG4gIHJldHVybiAnYXJuOicgKyBwYXJ0aXRpb24gKyAnOicgKyBzZXJ2aWNlICsgJzonICsgcmVnaW9uICsgJzonICsgYWNjb3VudElkICsgJzonICsgcmVzb3VyY2Vcbn1cblxuZXhwb3J0IGNvbnN0IE9iamVjdENyZWF0ZWRBbGwgPSAnczM6T2JqZWN0Q3JlYXRlZDoqJ1xuZXhwb3J0IGNvbnN0IE9iamVjdENyZWF0ZWRQdXQgPSAnczM6T2JqZWN0Q3JlYXRlZDpQdXQnXG5leHBvcnQgY29uc3QgT2JqZWN0Q3JlYXRlZFBvc3QgPSAnczM6T2JqZWN0Q3JlYXRlZDpQb3N0J1xuZXhwb3J0IGNvbnN0IE9iamVjdENyZWF0ZWRDb3B5ID0gJ3MzOk9iamVjdENyZWF0ZWQ6Q29weSdcbmV4cG9ydCBjb25zdCBPYmplY3RDcmVhdGVkQ29tcGxldGVNdWx0aXBhcnRVcGxvYWQgPSAnczM6T2JqZWN0Q3JlYXRlZDpDb21wbGV0ZU11bHRpcGFydFVwbG9hZCdcbmV4cG9ydCBjb25zdCBPYmplY3RSZW1vdmVkQWxsID0gJ3MzOk9iamVjdFJlbW92ZWQ6KidcbmV4cG9ydCBjb25zdCBPYmplY3RSZW1vdmVkRGVsZXRlID0gJ3MzOk9iamVjdFJlbW92ZWQ6RGVsZXRlJ1xuZXhwb3J0IGNvbnN0IE9iamVjdFJlbW92ZWREZWxldGVNYXJrZXJDcmVhdGVkID0gJ3MzOk9iamVjdFJlbW92ZWQ6RGVsZXRlTWFya2VyQ3JlYXRlZCdcbmV4cG9ydCBjb25zdCBPYmplY3RSZWR1Y2VkUmVkdW5kYW5jeUxvc3RPYmplY3QgPSAnczM6UmVkdWNlZFJlZHVuZGFuY3lMb3N0T2JqZWN0J1xuXG4vLyBQb2xsIGZvciBub3RpZmljYXRpb25zLCB1c2VkIGluICNsaXN0ZW5CdWNrZXROb3RpZmljYXRpb24uXG4vLyBMaXN0ZW5pbmcgY29uc3RpdHV0ZXMgcmVwZWF0ZWRseSByZXF1ZXN0aW5nIHMzIHdoZXRoZXIgb3Igbm90IGFueVxuLy8gY2hhbmdlcyBoYXZlIG9jY3VycmVkLlxuZXhwb3J0IGNsYXNzIE5vdGlmaWNhdGlvblBvbGxlciBleHRlbmRzIEV2ZW50RW1pdHRlciB7XG4gIGNvbnN0cnVjdG9yKGNsaWVudCwgYnVja2V0TmFtZSwgcHJlZml4LCBzdWZmaXgsIGV2ZW50cykge1xuICAgIHN1cGVyKClcblxuICAgIHRoaXMuY2xpZW50ID0gY2xpZW50XG4gICAgdGhpcy5idWNrZXROYW1lID0gYnVja2V0TmFtZVxuICAgIHRoaXMucHJlZml4ID0gcHJlZml4XG4gICAgdGhpcy5zdWZmaXggPSBzdWZmaXhcbiAgICB0aGlzLmV2ZW50cyA9IGV2ZW50c1xuXG4gICAgdGhpcy5lbmRpbmcgPSBmYWxzZVxuICB9XG5cbiAgLy8gU3RhcnRzIHRoZSBwb2xsaW5nLlxuICBzdGFydCgpIHtcbiAgICB0aGlzLmVuZGluZyA9IGZhbHNlXG5cbiAgICBwcm9jZXNzLm5leHRUaWNrKCgpID0+IHtcbiAgICAgIHRoaXMuY2hlY2tGb3JDaGFuZ2VzKClcbiAgICB9KVxuICB9XG5cbiAgLy8gU3RvcHMgdGhlIHBvbGxpbmcuXG4gIHN0b3AoKSB7XG4gICAgdGhpcy5lbmRpbmcgPSB0cnVlXG4gIH1cblxuICBjaGVja0ZvckNoYW5nZXMoKSB7XG4gICAgLy8gRG9uJ3QgY29udGludWUgaWYgd2UncmUgbG9vcGluZyBhZ2FpbiBidXQgYXJlIGNhbmNlbGxlZC5cbiAgICBpZiAodGhpcy5lbmRpbmcpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGxldCBtZXRob2QgPSAnR0VUJ1xuICAgIHZhciBxdWVyaWVzID0gW11cbiAgICBpZiAodGhpcy5wcmVmaXgpIHtcbiAgICAgIHZhciBwcmVmaXggPSB1cmlFc2NhcGUodGhpcy5wcmVmaXgpXG4gICAgICBxdWVyaWVzLnB1c2goYHByZWZpeD0ke3ByZWZpeH1gKVxuICAgIH1cbiAgICBpZiAodGhpcy5zdWZmaXgpIHtcbiAgICAgIHZhciBzdWZmaXggPSB1cmlFc2NhcGUodGhpcy5zdWZmaXgpXG4gICAgICBxdWVyaWVzLnB1c2goYHN1ZmZpeD0ke3N1ZmZpeH1gKVxuICAgIH1cbiAgICBpZiAodGhpcy5ldmVudHMpIHtcbiAgICAgIHRoaXMuZXZlbnRzLmZvckVhY2goKHMzZXZlbnQpID0+IHF1ZXJpZXMucHVzaCgnZXZlbnRzPScgKyB1cmlFc2NhcGUoczNldmVudCkpKVxuICAgIH1cbiAgICBxdWVyaWVzLnNvcnQoKVxuXG4gICAgdmFyIHF1ZXJ5ID0gJydcbiAgICBpZiAocXVlcmllcy5sZW5ndGggPiAwKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJpZXMuam9pbignJicpfWBcbiAgICB9XG4gICAgY29uc3QgcmVnaW9uID0gdGhpcy5jbGllbnQucmVnaW9uIHx8IERFRkFVTFRfUkVHSU9OXG4gICAgdGhpcy5jbGllbnQubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWU6IHRoaXMuYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdLCByZWdpb24sIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZW1pdCgnZXJyb3InLCBlKVxuICAgICAgfVxuXG4gICAgICBsZXQgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMuZ2V0Tm90aWZpY2F0aW9uVHJhbnNmb3JtZXIoKVxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcilcbiAgICAgICAgLm9uKCdkYXRhJywgKHJlc3VsdCkgPT4ge1xuICAgICAgICAgIC8vIERhdGEgaXMgZmx1c2hlZCBwZXJpb2RpY2FsbHkgKGV2ZXJ5IDUgc2Vjb25kcyksIHNvIHdlIHNob3VsZFxuICAgICAgICAgIC8vIGhhbmRsZSBpdCBhZnRlciBmbHVzaGluZyBmcm9tIHRoZSBKU09OIHBhcnNlci5cbiAgICAgICAgICBsZXQgcmVjb3JkcyA9IHJlc3VsdC5SZWNvcmRzXG4gICAgICAgICAgLy8gSWYgbnVsbCAoPSBubyByZWNvcmRzKSwgY2hhbmdlIHRvIGFuIGVtcHR5IGFycmF5LlxuICAgICAgICAgIGlmICghcmVjb3Jkcykge1xuICAgICAgICAgICAgcmVjb3JkcyA9IFtdXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gSXRlcmF0ZSBvdmVyIHRoZSBub3RpZmljYXRpb25zIGFuZCBlbWl0IHRoZW0gaW5kaXZpZHVhbGx5LlxuICAgICAgICAgIHJlY29yZHMuZm9yRWFjaCgocmVjb3JkKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmVtaXQoJ25vdGlmaWNhdGlvbicsIHJlY29yZClcbiAgICAgICAgICB9KVxuXG4gICAgICAgICAgLy8gSWYgd2UncmUgZG9uZSwgc3RvcC5cbiAgICAgICAgICBpZiAodGhpcy5lbmRpbmcpIHtcbiAgICAgICAgICAgIHJlc3BvbnNlLmRlc3Ryb3koKVxuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgICAgLm9uKCdlcnJvcicsIChlKSA9PiB0aGlzLmVtaXQoJ2Vycm9yJywgZSkpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4ge1xuICAgICAgICAgIC8vIERvIGl0IGFnYWluLCBpZiB3ZSBoYXZlbid0IGNhbmNlbGxlZCB5ZXQuXG4gICAgICAgICAgcHJvY2Vzcy5uZXh0VGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmNoZWNrRm9yQ2hhbmdlcygpXG4gICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICB9KVxuICB9XG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7O0FBZ0JBLElBQUFBLE9BQUEsR0FBQUMsT0FBQTtBQUVBLElBQUFDLFFBQUEsR0FBQUQsT0FBQTtBQUNBLElBQUFFLE9BQUEsR0FBQUYsT0FBQTtBQUNBLElBQUFHLFlBQUEsR0FBQUMsdUJBQUEsQ0FBQUosT0FBQTtBQUFpRCxTQUFBSyx5QkFBQUMsV0FBQSxlQUFBQyxPQUFBLGtDQUFBQyxpQkFBQSxPQUFBRCxPQUFBLFFBQUFFLGdCQUFBLE9BQUFGLE9BQUEsWUFBQUYsd0JBQUEsWUFBQUEsQ0FBQUMsV0FBQSxXQUFBQSxXQUFBLEdBQUFHLGdCQUFBLEdBQUFELGlCQUFBLEtBQUFGLFdBQUE7QUFBQSxTQUFBRix3QkFBQU0sR0FBQSxFQUFBSixXQUFBLFNBQUFBLFdBQUEsSUFBQUksR0FBQSxJQUFBQSxHQUFBLENBQUFDLFVBQUEsV0FBQUQsR0FBQSxRQUFBQSxHQUFBLG9CQUFBQSxHQUFBLHdCQUFBQSxHQUFBLDRCQUFBRSxPQUFBLEVBQUFGLEdBQUEsVUFBQUcsS0FBQSxHQUFBUix3QkFBQSxDQUFBQyxXQUFBLE9BQUFPLEtBQUEsSUFBQUEsS0FBQSxDQUFBQyxHQUFBLENBQUFKLEdBQUEsWUFBQUcsS0FBQSxDQUFBRSxHQUFBLENBQUFMLEdBQUEsU0FBQU0sTUFBQSxXQUFBQyxxQkFBQSxHQUFBQyxNQUFBLENBQUFDLGNBQUEsSUFBQUQsTUFBQSxDQUFBRSx3QkFBQSxXQUFBQyxHQUFBLElBQUFYLEdBQUEsUUFBQVcsR0FBQSxrQkFBQUgsTUFBQSxDQUFBSSxTQUFBLENBQUFDLGNBQUEsQ0FBQUMsSUFBQSxD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