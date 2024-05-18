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

import * as Crypto from "crypto";
import { Transform } from "stream";
import * as querystring from 'query-string';
import { getVersionId, sanitizeETag } from "./internal/helper.mjs";

// We extend Transform because Writable does not implement ._flush().
export class ObjectUploader extends Transform {
  constructor(client, bucketName, objectName, partSize, metaData, callback) {
    super();
    this.emptyStream = true;
    this.client = client;
    this.bucketName = bucketName;
    this.objectName = objectName;
    // The size of each multipart, chunked by BlockStream2.
    this.partSize = partSize;
    // This is the metadata for the object.
    this.metaData = metaData;

    // Call like: callback(error, {etag, versionId}).
    this.callback = callback;

    // We need to keep track of what number chunk/part we're on. This increments
    // each time _write() is called. Starts with 1, not 0.
    this.partNumber = 1;

    // A list of the previously uploaded chunks, for resuming a file upload. This
    // will be null if we aren't resuming an upload.
    this.oldParts = null;

    // Keep track of the etags for aggregating the chunks together later. Each
    // etag represents a single chunk of the file.
    this.etags = [];

    // This is for the multipart upload request — if null, we're either not initiated
    // yet or we're flushing in one packet.
    this.id = null;

    // Handle errors.
    this.on('error', err => {
      callback(err);
    });
  }
  _transform(chunk, encoding, callback) {
    this.emptyStream = false;
    let method = 'PUT';
    let headers = {
      'Content-Length': chunk.length
    };
    let md5digest = '';

    // Calculate and set Content-MD5 header if SHA256 is not set.
    // This will happen only when there is a secure connection to the s3 server.
    if (!this.client.enableSHA256) {
      md5digest = Crypto.createHash('md5').update(chunk).digest();
      headers['Content-MD5'] = md5digest.toString('base64');
    }
    // We can flush the object in one packet if it fits in one chunk. This is true
    // if the chunk size is smaller than the part size, signifying the end of the
    // stream.
    if (this.partNumber == 1 && chunk.length < this.partSize) {
      // PUT the chunk in a single request — use an empty query.
      let options = {
        method,
        // Set user metadata as this is not a multipart upload
        headers: Object.assign({}, this.metaData, headers),
        query: '',
        bucketName: this.bucketName,
        objectName: this.objectName
      };
      this.client.makeRequest(options, chunk, [200], '', true, (err, response) => {
        if (err) {
          return callback(err);
        }
        let result = {
          etag: sanitizeETag(response.headers.etag),
          versionId: getVersionId(response.headers)
        };
        // Ignore the 'data' event so that the stream closes. (nodejs stream requirement)
        response.on('data', () => {});

        // Give the etag back, we're done!

        process.nextTick(() => {
          this.callback(null, result);
        });

        // Because we're sure the stream has ended, allow it to flush and end.
        callback();
      });
      return;
    }

    // If we aren't flushing in one packet, we need to initiate the multipart upload,
    // if it hasn't already been done. The write will be buffered until the upload has been
    // initiated.
    if (this.id === null) {
      this.once('ready', () => {
        this._transform(chunk, encoding, callback);
      });

      // Check for an incomplete previous upload.
      this.client.findUploadId(this.bucketName, this.objectName, (err, id) => {
        if (err) {
          return this.emit('error', err);
        }

        // If no upload ID exists, initiate a new one.
        if (!id) {
          this.client.initiateNewMultipartUpload(this.bucketName, this.objectName, this.metaData).then(id => {
            this.id = id;

            // We are now ready to accept new chunks — this will flush the buffered chunk.
            this.emit('ready');
          }, err => callback(err));
          return;
        }
        this.id = id;

        // Retrieve the pre-uploaded parts, if we need to resume the upload.
        this.client.listParts(this.bucketName, this.objectName, id).then(etags => {
          // It is possible for no parts to be already uploaded.
          if (!etags) {
            etags = [];
          }

          // oldParts will become an object, allowing oldParts[partNumber].etag
          this.oldParts = etags.reduce(function (prev, item) {
            if (!prev[item.part]) {
              prev[item.part] = item;
            }
            return prev;
          }, {});
          this.emit('ready');
        }, err => {
          return this.emit('error', err);
        });
      });
      return;
    }

    // Continue uploading various parts if we have initiated multipart upload.
    let partNumber = this.partNumber++;

    // Check to see if we've already uploaded this chunk. If the hash sums match,
    // we can skip to the next chunk.
    if (this.oldParts) {
      let oldPart = this.oldParts[partNumber];

      // Calulcate the md5 hash, if it has not already been calculated.
      if (!md5digest) {
        md5digest = Crypto.createHash('md5').update(chunk).digest();
      }
      if (oldPart && md5digest.toString('hex') === oldPart.etag) {
        // The md5 matches, the chunk has already been uploaded.
        this.etags.push({
          part: partNumber,
          etag: oldPart.etag
        });
        callback();
        return;
      }
    }

    // Write the chunk with an uploader.
    let query = querystring.stringify({
      partNumber: partNumber,
      uploadId: this.id
    });
    let options = {
      method,
      query,
      headers,
      bucketName: this.bucketName,
      objectName: this.objectName
    };
    this.client.makeRequest(options, chunk, [200], '', true, (err, response) => {
      if (err) {
        return callback(err);
      }

      // In order to aggregate the parts together, we need to collect the etags.
      let etag = response.headers.etag;
      if (etag) {
        etag = etag.replace(/^"/, '').replace(/"$/, '');
      }
      this.etags.push({
        part: partNumber,
        etag
      });

      // Ignore the 'data' event so that the stream closes. (nodejs stream requirement)
      response.on('data', () => {});

      // We're ready for the next chunk.
      callback();
    });
  }
  _flush(callback) {
    if (this.emptyStream) {
      let method = 'PUT';
      let headers = Object.assign({}, this.metaData, {
        'Content-Length': 0
      });
      let options = {
        method,
        headers,
        query: '',
        bucketName: this.bucketName,
        objectName: this.objectName
      };
      this.client.makeRequest(options, '', [200], '', true, (err, response) => {
        if (err) {
          return callback(err);
        }
        let result = {
          etag: sanitizeETag(response.headers.etag),
          versionId: getVersionId(response.headers)
        };

        // Ignore the 'data' event so that the stream closes. (nodejs stream requirement)
        response.on('data', () => {});

        // Give the etag back, we're done!
        process.nextTick(() => {
          this.callback(null, result);
        });

        // Because we're sure the stream has ended, allow it to flush and end.
        callback();
      });
      return;
    }
    // If it has been uploaded in a single packet, we don't have to do anything.
    if (this.id === null) {
      return;
    }

    // This is called when all of the chunks uploaded successfully, thus
    // completing the multipart upload.
    this.client.completeMultipartUpload(this.bucketName, this.objectName, this.id, this.etags, (err, etag) => {
      if (err) {
        return callback(err);
      }

      // Call our callback on the next tick to allow the streams infrastructure
      // to finish what its doing before we continue.
      process.nextTick(() => {
        this.callback(null, etag);
      });
      callback();
    });
  }
}

// deprecated default export, please use named exports.
// keep for backward compatibility.
// eslint-disable-next-line import/no-default-export
export default ObjectUploader;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJDcnlwdG8iLCJUcmFuc2Zvcm0iLCJxdWVyeXN0cmluZyIsImdldFZlcnNpb25JZCIsInNhbml0aXplRVRhZyIsIk9iamVjdFVwbG9hZGVyIiwiY29uc3RydWN0b3IiLCJjbGllbnQiLCJidWNrZXROYW1lIiwib2JqZWN0TmFtZSIsInBhcnRTaXplIiwibWV0YURhdGEiLCJjYWxsYmFjayIsImVtcHR5U3RyZWFtIiwicGFydE51bWJlciIsIm9sZFBhcnRzIiwiZXRhZ3MiLCJpZCIsIm9uIiwiZXJyIiwiX3RyYW5zZm9ybSIsImNodW5rIiwiZW5jb2RpbmciLCJtZXRob2QiLCJoZWFkZXJzIiwibGVuZ3RoIiwibWQ1ZGlnZXN0IiwiZW5hYmxlU0hBMjU2IiwiY3JlYXRlSGFzaCIsInVwZGF0ZSIsImRpZ2VzdCIsInRvU3RyaW5nIiwib3B0aW9ucyIsIk9iamVjdCIsImFzc2lnbiIsInF1ZXJ5IiwibWFrZVJlcXVlc3QiLCJyZXNwb25zZSIsInJlc3VsdCIsImV0YWciLCJ2ZXJzaW9uSWQiLCJwcm9jZXNzIiwibmV4dFRpY2siLCJvbmNlIiwiZmluZFVwbG9hZElkIiwiZW1pdCIsImluaXRpYXRlTmV3TXVsdGlwYXJ0VXBsb2FkIiwidGhlbiIsImxpc3RQYXJ0cyIsInJlZHVjZSIsInByZXYiLCJpdGVtIiwicGFydCIsIm9sZFBhcnQiLCJwdXNoIiwic3RyaW5naWZ5IiwidXBsb2FkSWQiLCJyZXBsYWNlIiwiX2ZsdXNoIiwiY29tcGxldGVNdWx0aXBhcnRVcGxvYWQiXSwic291cmNlcyI6WyJvYmplY3QtdXBsb2FkZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLypcbiAqIE1pbklPIEphdmFzY3JpcHQgTGlicmFyeSBmb3IgQW1hem9uIFMzIENvbXBhdGlibGUgQ2xvdWQgU3RvcmFnZSwgKEMpIDIwMTYgTWluSU8sIEluYy5cbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKi9cblxuaW1wb3J0ICogYXMgQ3J5cHRvIGZyb20gJ25vZGU6Y3J5cHRvJ1xuaW1wb3J0IHsgVHJhbnNmb3JtIH0gZnJvbSAnbm9kZTpzdHJlYW0nXG5cbmltcG9ydCAqIGFzIHF1ZXJ5c3RyaW5nIGZyb20gJ3F1ZXJ5LXN0cmluZydcblxuaW1wb3J0IHsgZ2V0VmVyc2lvbklkLCBzYW5pdGl6ZUVUYWcgfSBmcm9tICcuL2ludGVybmFsL2hlbHBlci50cydcblxuLy8gV2UgZXh0ZW5kIFRyYW5zZm9ybSBiZWNhdXNlIFdyaXRhYmxlIGRvZXMgbm90IGltcGxlbWVudCAuX2ZsdXNoKCkuXG5leHBvcnQgY2xhc3MgT2JqZWN0VXBsb2FkZXIgZXh0ZW5kcyBUcmFuc2Zvcm0ge1xuICBjb25zdHJ1Y3RvcihjbGllbnQsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHBhcnRTaXplLCBtZXRhRGF0YSwgY2FsbGJhY2spIHtcbiAgICBzdXBlcigpXG4gICAgdGhpcy5lbXB0eVN0cmVhbSA9IHRydWVcbiAgICB0aGlzLmNsaWVudCA9IGNsaWVudFxuICAgIHRoaXMuYnVja2V0TmFtZSA9IGJ1Y2tldE5hbWVcbiAgICB0aGlzLm9iamVjdE5hbWUgPSBvYmplY3ROYW1lXG4gICAgLy8gVGhlIHNpemUgb2YgZWFjaCBtdWx0aXBhcnQsIGNodW5rZWQgYnkgQmxvY2tTdHJlYW0yLlxuICAgIHRoaXMucGFydFNpemUgPSBwYXJ0U2l6ZVxuICAgIC8vIFRoaXMgaXMgdGhlIG1ldGFkYXRhIGZvciB0aGUgb2JqZWN0LlxuICAgIHRoaXMubWV0YURhdGEgPSBtZXRhRGF0YVxuXG4gICAgLy8gQ2FsbCBsaWtlOiBjYWxsYmFjayhlcnJvciwge2V0YWcsIHZlcnNpb25JZH0pLlxuICAgIHRoaXMuY2FsbGJhY2sgPSBjYWxsYmFja1xuXG4gICAgLy8gV2UgbmVlZCB0byBrZWVwIHRyYWNrIG9mIHdoYXQgbnVtYmVyIGNodW5rL3BhcnQgd2UncmUgb24uIFRoaXMgaW5jcmVtZW50c1xuICAgIC8vIGVhY2ggdGltZSBfd3JpdGUoKSBpcyBjYWxsZWQuIFN0YXJ0cyB3aXRoIDEsIG5vdCAwLlxuICAgIHRoaXMucGFydE51bWJlciA9IDFcblxuICAgIC8vIEEgbGlzdCBvZiB0aGUgcHJldmlvdXNseSB1cGxvYWRlZCBjaHVua3MsIGZvciByZXN1bWluZyBhIGZpbGUgdXBsb2FkLiBUaGlzXG4gICAgLy8gd2lsbCBiZSBudWxsIGlmIHdlIGFyZW4ndCByZXN1bWluZyBhbiB1cGxvYWQuXG4gICAgdGhpcy5vbGRQYXJ0cyA9IG51bGxcblxuICAgIC8vIEtlZXAgdHJhY2sgb2YgdGhlIGV0YWdzIGZvciBhZ2dyZWdhdGluZyB0aGUgY2h1bmtzIHRvZ2V0aGVyIGxhdGVyLiBFYWNoXG4gICAgLy8gZXRhZyByZXByZXNlbnRzIGEgc2luZ2xlIGNodW5rIG9mIHRoZSBmaWxlLlxuICAgIHRoaXMuZXRhZ3MgPSBbXVxuXG4gICAgLy8gVGhpcyBpcyBmb3IgdGhlIG11bHRpcGFydCB1cGxvYWQgcmVxdWVzdCDigJQgaWYgbnVsbCwgd2UncmUgZWl0aGVyIG5vdCBpbml0aWF0ZWRcbiAgICAvLyB5ZXQgb3Igd2UncmUgZmx1c2hpbmcgaW4gb25lIHBhY2tldC5cbiAgICB0aGlzLmlkID0gbnVsbFxuXG4gICAgLy8gSGFuZGxlIGVycm9ycy5cbiAgICB0aGlzLm9uKCdlcnJvcicsIChlcnIpID0+IHtcbiAgICAgIGNhbGxiYWNrKGVycilcbiAgICB9KVxuICB9XG5cbiAgX3RyYW5zZm9ybShjaHVuaywgZW5jb2RpbmcsIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5lbXB0eVN0cmVhbSA9IGZhbHNlXG4gICAgbGV0IG1ldGhvZCA9ICdQVVQnXG4gICAgbGV0IGhlYWRlcnMgPSB7ICdDb250ZW50LUxlbmd0aCc6IGNodW5rLmxlbmd0aCB9XG4gICAgbGV0IG1kNWRpZ2VzdCA9ICcnXG5cbiAgICAvLyBDYWxjdWxhdGUgYW5kIHNldCBDb250ZW50LU1ENSBoZWFkZXIgaWYgU0hBMjU2IGlzIG5vdCBzZXQuXG4gICAgLy8gVGhpcyB3aWxsIGhhcHBlbiBvbmx5IHdoZW4gdGhlcmUgaXMgYSBzZWN1cmUgY29ubmVjdGlvbiB0byB0aGUgczMgc2VydmVyLlxuICAgIGlmICghdGhpcy5jbGllbnQuZW5hYmxlU0hBMjU2KSB7XG4gICAgICBtZDVkaWdlc3QgPSBDcnlwdG8uY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKGNodW5rKS5kaWdlc3QoKVxuICAgICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IG1kNWRpZ2VzdC50b1N0cmluZygnYmFzZTY0JylcbiAgICB9XG4gICAgLy8gV2UgY2FuIGZsdXNoIHRoZSBvYmplY3QgaW4gb25lIHBhY2tldCBpZiBpdCBmaXRzIGluIG9uZSBjaHVuay4gVGhpcyBpcyB0cnVlXG4gICAgLy8gaWYgdGhlIGNodW5rIHNpemUgaXMgc21hbGxlciB0aGFuIHRoZSBwYXJ0IHNpemUsIHNpZ25pZnlpbmcgdGhlIGVuZCBvZiB0aGVcbiAgICAvLyBzdHJlYW0uXG4gICAgaWYgKHRoaXMucGFydE51bWJlciA9PSAxICYmIGNodW5rLmxlbmd0aCA8IHRoaXMucGFydFNpemUpIHtcbiAgICAgIC8vIFBVVCB0aGUgY2h1bmsgaW4gYSBzaW5nbGUgcmVxdWVzdCDigJQgdXNlIGFuIGVtcHR5IHF1ZXJ5LlxuICAgICAgbGV0IG9wdGlvbnMgPSB7XG4gICAgICAgIG1ldGhvZCxcbiAgICAgICAgLy8gU2V0IHVzZXIgbWV0YWRhdGEgYXMgdGhpcyBpcyBub3QgYSBtdWx0aXBhcnQgdXBsb2FkXG4gICAgICAgIGhlYWRlcnM6IE9iamVjdC5hc3NpZ24oe30sIHRoaXMubWV0YURhdGEsIGhlYWRlcnMpLFxuICAgICAgICBxdWVyeTogJycsXG4gICAgICAgIGJ1Y2tldE5hbWU6IHRoaXMuYnVja2V0TmFtZSxcbiAgICAgICAgb2JqZWN0TmFtZTogdGhpcy5vYmplY3ROYW1lLFxuICAgICAgfVxuXG4gICAgICB0aGlzLmNsaWVudC5tYWtlUmVxdWVzdChvcHRpb25zLCBjaHVuaywgWzIwMF0sICcnLCB0cnVlLCAoZXJyLCByZXNwb25zZSkgPT4ge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycilcbiAgICAgICAgfVxuICAgICAgICBsZXQgcmVzdWx0ID0ge1xuICAgICAgICAgIGV0YWc6IHNhbml0aXplRVRhZyhyZXNwb25zZS5oZWFkZXJzLmV0YWcpLFxuICAgICAgICAgIHZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlc3BvbnNlLmhlYWRlcnMpLFxuICAgICAgICB9XG4gICAgICAgIC8vIElnbm9yZSB0aGUgJ2RhdGEnIGV2ZW50IHNvIHRoYXQgdGhlIHN0cmVhbSBjbG9zZXMuIChub2RlanMgc3RyZWFtIHJlcXVpcmVtZW50KVxuICAgICAgICByZXNwb25zZS5vbignZGF0YScsICgpID0+IHt9KVxuXG4gICAgICAgIC8vIEdpdmUgdGhlIGV0YWcgYmFjaywgd2UncmUgZG9uZSFcblxuICAgICAgICBwcm9jZXNzLm5leHRUaWNrKCgpID0+IHtcbiAgICAgICAgICB0aGlzLmNhbGxiYWNrKG51bGwsIHJlc3VsdClcbiAgICAgICAgfSlcblxuICAgICAgICAvLyBCZWNhdXNlIHdlJ3JlIHN1cmUgdGhlIHN0cmVhbSBoYXMgZW5kZWQsIGFsbG93IGl0IHRvIGZsdXNoIGFuZCBlbmQuXG4gICAgICAgIGNhbGxiYWNrKClcbiAgICAgIH0pXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIC8vIElmIHdlIGFyZW4ndCBmbHVzaGluZyBpbiBvbmUgcGFja2V0LCB3ZSBuZWVkIHRvIGluaXRpYXRlIHRoZSBtdWx0aXBhcnQgdXBsb2FkLFxuICAgIC8vIGlmIGl0IGhhc24ndCBhbHJlYWR5IGJlZW4gZG9uZS4gVGhlIHdyaXRlIHdpbGwgYmUgYnVmZmVyZWQgdW50aWwgdGhlIHVwbG9hZCBoYXMgYmVlblxuICAgIC8vIGluaXRpYXRlZC5cbiAgICBpZiAodGhpcy5pZCA9PT0gbnVsbCkge1xuICAgICAgdGhpcy5vbmNlKCdyZWFkeScsICgpID0+IHtcbiAgICAgICAgdGhpcy5fdHJhbnNmb3JtKGNodW5rLCBlbmNvZGluZywgY2FsbGJhY2spXG4gICAgICB9KVxuXG4gICAgICAvLyBDaGVjayBmb3IgYW4gaW5jb21wbGV0ZSBwcmV2aW91cyB1cGxvYWQuXG4gICAgICB0aGlzLmNsaWVudC5maW5kVXBsb2FkSWQodGhpcy5idWNrZXROYW1lLCB0aGlzLm9iamVjdE5hbWUsIChlcnIsIGlkKSA9PiB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5lbWl0KCdlcnJvcicsIGVycilcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElmIG5vIHVwbG9hZCBJRCBleGlzdHMsIGluaXRpYXRlIGEgbmV3IG9uZS5cbiAgICAgICAgaWYgKCFpZCkge1xuICAgICAgICAgIHRoaXMuY2xpZW50LmluaXRpYXRlTmV3TXVsdGlwYXJ0VXBsb2FkKHRoaXMuYnVja2V0TmFtZSwgdGhpcy5vYmplY3ROYW1lLCB0aGlzLm1ldGFEYXRhKS50aGVuKFxuICAgICAgICAgICAgKGlkKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuaWQgPSBpZFxuXG4gICAgICAgICAgICAgIC8vIFdlIGFyZSBub3cgcmVhZHkgdG8gYWNjZXB0IG5ldyBjaHVua3Mg4oCUIHRoaXMgd2lsbCBmbHVzaCB0aGUgYnVmZmVyZWQgY2h1bmsuXG4gICAgICAgICAgICAgIHRoaXMuZW1pdCgncmVhZHknKVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIChlcnIpID0+IGNhbGxiYWNrKGVyciksXG4gICAgICAgICAgKVxuXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmlkID0gaWRcblxuICAgICAgICAvLyBSZXRyaWV2ZSB0aGUgcHJlLXVwbG9hZGVkIHBhcnRzLCBpZiB3ZSBuZWVkIHRvIHJlc3VtZSB0aGUgdXBsb2FkLlxuICAgICAgICB0aGlzLmNsaWVudC5saXN0UGFydHModGhpcy5idWNrZXROYW1lLCB0aGlzLm9iamVjdE5hbWUsIGlkKS50aGVuKFxuICAgICAgICAgIChldGFncykgPT4ge1xuICAgICAgICAgICAgLy8gSXQgaXMgcG9zc2libGUgZm9yIG5vIHBhcnRzIHRvIGJlIGFscmVhZHkgdXBsb2FkZWQuXG4gICAgICAgICAgICBpZiAoIWV0YWdzKSB7XG4gICAgICAgICAgICAgIGV0YWdzID0gW11cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gb2xkUGFydHMgd2lsbCBiZWNvbWUgYW4gb2JqZWN0LCBhbGxvd2luZyBvbGRQYXJ0c1twYXJ0TnVtYmVyXS5ldGFnXG4gICAgICAgICAgICB0aGlzLm9sZFBhcnRzID0gZXRhZ3MucmVkdWNlKGZ1bmN0aW9uIChwcmV2LCBpdGVtKSB7XG4gICAgICAgICAgICAgIGlmICghcHJldltpdGVtLnBhcnRdKSB7XG4gICAgICAgICAgICAgICAgcHJldltpdGVtLnBhcnRdID0gaXRlbVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJldHVybiBwcmV2XG4gICAgICAgICAgICB9LCB7fSlcblxuICAgICAgICAgICAgdGhpcy5lbWl0KCdyZWFkeScpXG4gICAgICAgICAgfSxcbiAgICAgICAgICAoZXJyKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5lbWl0KCdlcnJvcicsIGVycilcbiAgICAgICAgICB9LFxuICAgICAgICApXG4gICAgICB9KVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICAvLyBDb250aW51ZSB1cGxvYWRpbmcgdmFyaW91cyBwYXJ0cyBpZiB3ZSBoYXZlIGluaXRpYXRlZCBtdWx0aXBhcnQgdXBsb2FkLlxuICAgIGxldCBwYXJ0TnVtYmVyID0gdGhpcy5wYXJ0TnVtYmVyKytcblxuICAgIC8vIENoZWNrIHRvIHNlZSBpZiB3ZSd2ZSBhbHJlYWR5IHVwbG9hZGVkIHRoaXMgY2h1bmsuIElmIHRoZSBoYXNoIHN1bXMgbWF0Y2gsXG4gICAgLy8gd2UgY2FuIHNraXAgdG8gdGhlIG5leHQgY2h1bmsuXG4gICAgaWYgKHRoaXMub2xkUGFydHMpIHtcbiAgICAgIGxldCBvbGRQYXJ0ID0gdGhpcy5vbGRQYXJ0c1twYXJ0TnVtYmVyXVxuXG4gICAgICAvLyBDYWx1bGNhdGUgdGhlIG1kNSBoYXNoLCBpZiBpdCBoYXMgbm90IGFscmVhZHkgYmVlbiBjYWxjdWxhdGVkLlxuICAgICAgaWYgKCFtZDVkaWdlc3QpIHtcbiAgICAgICAgbWQ1ZGlnZXN0ID0gQ3J5cHRvLmNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShjaHVuaykuZGlnZXN0KClcbiAgICAgIH1cblxuICAgICAgaWYgKG9sZFBhcnQgJiYgbWQ1ZGlnZXN0LnRvU3RyaW5nKCdoZXgnKSA9PT0gb2xkUGFydC5ldGFnKSB7XG4gICAgICAgIC8vIFRoZSBtZDUgbWF0Y2hlcywgdGhlIGNodW5rIGhhcyBhbHJlYWR5IGJlZW4gdXBsb2FkZWQuXG4gICAgICAgIHRoaXMuZXRhZ3MucHVzaCh7IHBhcnQ6IHBhcnROdW1iZXIsIGV0YWc6IG9sZFBhcnQuZXRhZyB9KVxuXG4gICAgICAgIGNhbGxiYWNrKClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gV3JpdGUgdGhlIGNodW5rIHdpdGggYW4gdXBsb2FkZXIuXG4gICAgbGV0IHF1ZXJ5ID0gcXVlcnlzdHJpbmcuc3RyaW5naWZ5KHtcbiAgICAgIHBhcnROdW1iZXI6IHBhcnROdW1iZXIsXG4gICAgICB1cGxvYWRJZDogdGhpcy5pZCxcbiAgICB9KVxuXG4gICAgbGV0IG9wdGlvbnMgPSB7XG4gICAgICBtZXRob2QsXG4gICAgICBxdWVyeSxcbiAgICAgIGhlYWRlcnMsXG4gICAgICBidWNrZXROYW1lOiB0aGlzLmJ1Y2tldE5hbWUsXG4gICAgICBvYmplY3ROYW1lOiB0aGlzLm9iamVjdE5hbWUsXG4gICAgfVxuXG4gICAgdGhpcy5jbGllbnQubWFrZVJlcXVlc3Qob3B0aW9ucywgY2h1bmssIFsyMDBdLCAnJywgdHJ1ZSwgKGVyciwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycilcbiAgICAgIH1cblxuICAgICAgLy8gSW4gb3JkZXIgdG8gYWdncmVnYXRlIHRoZSBwYXJ0cyB0b2dldGhlciwgd2UgbmVlZCB0byBjb2xsZWN0IHRoZSBldGFncy5cbiAgICAgIGxldCBldGFnID0gcmVzcG9uc2UuaGVhZGVycy5ldGFnXG4gICAgICBpZiAoZXRhZykge1xuICAgICAgICBldGFnID0gZXRhZy5yZXBsYWNlKC9eXCIvLCAnJykucmVwbGFjZSgvXCIkLywgJycpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuZXRhZ3MucHVzaCh7IHBhcnQ6IHBhcnROdW1iZXIsIGV0YWcgfSlcblxuICAgICAgLy8gSWdub3JlIHRoZSAnZGF0YScgZXZlbnQgc28gdGhhdCB0aGUgc3RyZWFtIGNsb3Nlcy4gKG5vZGVqcyBzdHJlYW0gcmVxdWlyZW1lbnQpXG4gICAgICByZXNwb25zZS5vbignZGF0YScsICgpID0+IHt9KVxuXG4gICAgICAvLyBXZSdyZSByZWFkeSBmb3IgdGhlIG5leHQgY2h1bmsuXG4gICAgICBjYWxsYmFjaygpXG4gICAgfSlcbiAgfVxuXG4gIF9mbHVzaChjYWxsYmFjaykge1xuICAgIGlmICh0aGlzLmVtcHR5U3RyZWFtKSB7XG4gICAgICBsZXQgbWV0aG9kID0gJ1BVVCdcbiAgICAgIGxldCBoZWFkZXJzID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5tZXRhRGF0YSwgeyAnQ29udGVudC1MZW5ndGgnOiAwIH0pXG4gICAgICBsZXQgb3B0aW9ucyA9IHtcbiAgICAgICAgbWV0aG9kLFxuICAgICAgICBoZWFkZXJzLFxuICAgICAgICBxdWVyeTogJycsXG4gICAgICAgIGJ1Y2tldE5hbWU6IHRoaXMuYnVja2V0TmFtZSxcbiAgICAgICAgb2JqZWN0TmFtZTogdGhpcy5vYmplY3ROYW1lLFxuICAgICAgfVxuXG4gICAgICB0aGlzLmNsaWVudC5tYWtlUmVxdWVzdChvcHRpb25zLCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZXJyLCByZXNwb25zZSkgPT4ge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycilcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCByZXN1bHQgPSB7XG4gICAgICAgICAgZXRhZzogc2FuaXRpemVFVGFnKHJlc3BvbnNlLmhlYWRlcnMuZXRhZyksXG4gICAgICAgICAgdmVyc2lvbklkOiBnZXRWZXJzaW9uSWQocmVzcG9uc2UuaGVhZGVycyksXG4gICAgICAgIH1cblxuICAgICAgICAvLyBJZ25vcmUgdGhlICdkYXRhJyBldmVudCBzbyB0aGF0IHRoZSBzdHJlYW0gY2xvc2VzLiAobm9kZWpzIHN0cmVhbSByZXF1aXJlbWVudClcbiAgICAgICAgcmVzcG9uc2Uub24oJ2RhdGEnLCAoKSA9PiB7fSlcblxuICAgICAgICAvLyBHaXZlIHRoZSBldGFnIGJhY2ssIHdlJ3JlIGRvbmUhXG4gICAgICAgIHByb2Nlc3MubmV4dFRpY2soKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2FsbGJhY2sobnVsbCwgcmVzdWx0KVxuICAgICAgICB9KVxuXG4gICAgICAgIC8vIEJlY2F1c2Ugd2UncmUgc3VyZSB0aGUgc3RyZWFtIGhhcyBlbmRlZCwgYWxsb3cgaXQgdG8gZmx1c2ggYW5kIGVuZC5cbiAgICAgICAgY2FsbGJhY2soKVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIC8vIElmIGl0IGhhcyBiZWVuIHVwbG9hZGVkIGluIGEgc2luZ2xlIHBhY2tldCwgd2UgZG9uJ3QgaGF2ZSB0byBkbyBhbnl0aGluZy5cbiAgICBpZiAodGhpcy5pZCA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgLy8gVGhpcyBpcyBjYWxsZWQgd2hlbiBhbGwgb2YgdGhlIGNodW5rcyB1cGxvYWRlZCBzdWNjZXNzZnVsbHksIHRodXNcbiAgICAvLyBjb21wbGV0aW5nIHRoZSBtdWx0aXBhcnQgdXBsb2FkLlxuICAgIHRoaXMuY2xpZW50LmNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkKHRoaXMuYnVja2V0TmFtZSwgdGhpcy5vYmplY3ROYW1lLCB0aGlzLmlkLCB0aGlzLmV0YWdzLCAoZXJyLCBldGFnKSA9PiB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpXG4gICAgICB9XG5cbiAgICAgIC8vIENhbGwgb3VyIGNhbGxiYWNrIG9uIHRoZSBuZXh0IHRpY2sgdG8gYWxsb3cgdGhlIHN0cmVhbXMgaW5mcmFzdHJ1Y3R1cmVcbiAgICAgIC8vIHRvIGZpbmlzaCB3aGF0IGl0cyBkb2luZyBiZWZvcmUgd2UgY29udGludWUuXG4gICAgICBwcm9jZXNzLm5leHRUaWNrKCgpID0+IHtcbiAgICAgICAgdGhpcy5jYWxsYmFjayhudWxsLCBldGFnKVxuICAgICAgfSlcblxuICAgICAgY2FsbGJhY2soKVxuICAgIH0pXG4gIH1cbn1cblxuLy8gZGVwcmVjYXRlZCBkZWZhdWx0IGV4cG9ydCwgcGxlYXNlIHVzZSBuYW1lZCBleHBvcnRzLlxuLy8ga2VlcCBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eS5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBpbXBvcnQvbm8tZGVmYXVsdC1leHBvcnRcbmV4cG9ydCBkZWZhdWx0IE9iamVjdFVwbG9hZGVyXG4iXSwibWFwcGluZ3MiOiJBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxPQUFPLEtBQUtBLE1BQU07QUFDbEIsU0FBU0MsU0FBUztBQUVsQixPQUFPLEtBQUtDLFdBQVcsTUFBTSxjQUFjO0FBRTNDLFNBQVNDLFlBQVksRUFBRUMsWUFBWSxRQUFRLHVCQUFzQjs7QUFFakU7QUFDQSxPQUFPLE1BQU1DLGNBQWMsU0FBU0osU0FBUyxDQUFDO0VBQzVDSyxXQUFXQSxDQUFDQyxNQUFNLEVBQUVDLFVBQVUsRUFBRUMsVUFBVSxFQUFFQyxRQUFRLEVBQUVDLFFBQVEsRUFBRUMsUUFBUSxFQUFFO0lBQ3hFLEtBQUssQ0FBQyxDQUFDO0lBQ1AsSUFBSSxDQUFDQyxXQUFXLEdBQUcsSUFBSTtJQUN2QixJQUFJLENBQUNOLE1BQU0sR0FBR0EsTUFBTTtJQUNwQixJQUFJLENBQUNDLFVBQVUsR0FBR0EsVUFBVTtJQUM1QixJQUFJLENBQUNDLFVBQVUsR0FBR0EsVUFBVTtJQUM1QjtJQUNBLElBQUksQ0FBQ0MsUUFBUSxHQUFHQSxRQUFRO0lBQ3hCO0lBQ0EsSUFBSSxDQUFDQyxRQUFRLEdBQUdBLFFBQVE7O0lBRXhCO0lBQ0EsSUFBSSxDQUFDQyxRQUFRLEdBQUdBLFFBQVE7O0lBRXhCO0lBQ0E7SUFDQSxJQUFJLENBQUNFLFVBQVUsR0FBRyxDQUFDOztJQUVuQjtJQUNBO0lBQ0EsSUFBSSxDQUFDQyxRQUFRLEdBQUcsSUFBSTs7SUFFcEI7SUFDQTtJQUNBLElBQUksQ0FBQ0MsS0FBSyxHQUFHLEVBQUU7O0lBRWY7SUFDQTtJQUNBLElBQUksQ0FBQ0MsRUFBRSxHQUFHLElBQUk7O0lB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