var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf, __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from == "object" || typeof from == "function")
    for (let key of __getOwnPropNames(from))
      !__hasOwnProp.call(to, key) && key !== except && __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: !0 }) : target,
  mod
));

// node_modules/.pnpm/base64-js@1.5.1/node_modules/base64-js/index.js
var require_base64_js = __commonJS({
  "node_modules/.pnpm/base64-js@1.5.1/node_modules/base64-js/index.js"(exports) {
    "use strict";
    exports.byteLength = byteLength;
    exports.toByteArray = toByteArray;
    exports.fromByteArray = fromByteArray;
    var lookup = [], revLookup = [], Arr = typeof Uint8Array < "u" ? Uint8Array : Array, code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (i = 0, len = code.length; i < len; ++i)
      lookup[i] = code[i], revLookup[code.charCodeAt(i)] = i;
    var i, len;
    revLookup[45] = 62;
    revLookup[95] = 63;
    function getLens(b64) {
      var len2 = b64.length;
      if (len2 % 4 > 0)
        throw new Error("Invalid string. Length must be a multiple of 4");
      var validLen = b64.indexOf("=");
      validLen === -1 && (validLen = len2);
      var placeHoldersLen = validLen === len2 ? 0 : 4 - validLen % 4;
      return [validLen, placeHoldersLen];
    }
    function byteLength(b64) {
      var lens = getLens(b64), validLen = lens[0], placeHoldersLen = lens[1];
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function _byteLength(b64, validLen, placeHoldersLen) {
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function toByteArray(b64) {
      var tmp, lens = getLens(b64), validLen = lens[0], placeHoldersLen = lens[1], arr = new Arr(_byteLength(b64, validLen, placeHoldersLen)), curByte = 0, len2 = placeHoldersLen > 0 ? validLen - 4 : validLen, i2;
      for (i2 = 0; i2 < len2; i2 += 4)
        tmp = revLookup[b64.charCodeAt(i2)] << 18 | revLookup[b64.charCodeAt(i2 + 1)] << 12 | revLookup[b64.charCodeAt(i2 + 2)] << 6 | revLookup[b64.charCodeAt(i2 + 3)], arr[curByte++] = tmp >> 16 & 255, arr[curByte++] = tmp >> 8 & 255, arr[curByte++] = tmp & 255;
      return placeHoldersLen === 2 && (tmp = revLookup[b64.charCodeAt(i2)] << 2 | revLookup[b64.charCodeAt(i2 + 1)] >> 4, arr[curByte++] = tmp & 255), placeHoldersLen === 1 && (tmp = revLookup[b64.charCodeAt(i2)] << 10 | revLookup[b64.charCodeAt(i2 + 1)] << 4 | revLookup[b64.charCodeAt(i2 + 2)] >> 2, arr[curByte++] = tmp >> 8 & 255, arr[curByte++] = tmp & 255), arr;
    }
    function tripletToBase64(num) {
      return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
    }
    function encodeChunk(uint8, start2, end) {
      for (var tmp, output = [], i2 = start2; i2 < end; i2 += 3)
        tmp = (uint8[i2] << 16 & 16711680) + (uint8[i2 + 1] << 8 & 65280) + (uint8[i2 + 2] & 255), output.push(tripletToBase64(tmp));
      return output.join("");
    }
    function fromByteArray(uint8) {
      for (var tmp, len2 = uint8.length, extraBytes = len2 % 3, parts = [], maxChunkLength = 16383, i2 = 0, len22 = len2 - extraBytes; i2 < len22; i2 += maxChunkLength)
        parts.push(encodeChunk(uint8, i2, i2 + maxChunkLength > len22 ? len22 : i2 + maxChunkLength));
      return extraBytes === 1 ? (tmp = uint8[len2 - 1], parts.push(
        lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "=="
      )) : extraBytes === 2 && (tmp = (uint8[len2 - 2] << 8) + uint8[len2 - 1], parts.push(
        lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "="
      )), parts.join("");
    }
  }
});

// node_modules/.pnpm/ieee754@1.2.1/node_modules/ieee754/index.js
var require_ieee754 = __commonJS({
  "node_modules/.pnpm/ieee754@1.2.1/node_modules/ieee754/index.js"(exports) {
    exports.read = function(buffer, offset, isLE, mLen, nBytes) {
      var e, m, eLen = nBytes * 8 - mLen - 1, eMax = (1 << eLen) - 1, eBias = eMax >> 1, nBits = -7, i = isLE ? nBytes - 1 : 0, d = isLE ? -1 : 1, s2 = buffer[offset + i];
      for (i += d, e = s2 & (1 << -nBits) - 1, s2 >>= -nBits, nBits += eLen; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8)
        ;
      for (m = e & (1 << -nBits) - 1, e >>= -nBits, nBits += mLen; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8)
        ;
      if (e === 0)
        e = 1 - eBias;
      else {
        if (e === eMax)
          return m ? NaN : (s2 ? -1 : 1) * (1 / 0);
        m = m + Math.pow(2, mLen), e = e - eBias;
      }
      return (s2 ? -1 : 1) * m * Math.pow(2, e - mLen);
    };
    exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
      var e, m, c, eLen = nBytes * 8 - mLen - 1, eMax = (1 << eLen) - 1, eBias = eMax >> 1, rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0, i = isLE ? 0 : nBytes - 1, d = isLE ? 1 : -1, s2 = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
      for (value = Math.abs(value), isNaN(value) || value === 1 / 0 ? (m = isNaN(value) ? 1 : 0, e = eMax) : (e = Math.floor(Math.log(value) / Math.LN2), value * (c = Math.pow(2, -e)) < 1 && (e--, c *= 2), e + eBias >= 1 ? value += rt / c : value += rt * Math.pow(2, 1 - eBias), value * c >= 2 && (e++, c /= 2), e + eBias >= eMax ? (m = 0, e = eMax) : e + eBias >= 1 ? (m = (value * c - 1) * Math.pow(2, mLen), e = e + eBias) : (m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen), e = 0)); mLen >= 8; buffer[offset + i] = m & 255, i += d, m /= 256, mLen -= 8)
        ;
      for (e = e << mLen | m, eLen += mLen; eLen > 0; buffer[offset + i] = e & 255, i += d, e /= 256, eLen -= 8)
        ;
      buffer[offset + i - d] |= s2 * 128;
    };
  }
});

// node_modules/.pnpm/buffer@6.0.3/node_modules/buffer/index.js
var require_buffer = __commonJS({
  "node_modules/.pnpm/buffer@6.0.3/node_modules/buffer/index.js"(exports) {
    "use strict";
    var base64 = require_base64_js(), ieee754 = require_ieee754(), customInspectSymbol = typeof Symbol == "function" && typeof Symbol.for == "function" ? /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom") : null;
    exports.Buffer = Buffer6;
    exports.SlowBuffer = SlowBuffer;
    exports.INSPECT_MAX_BYTES = 50;
    var K_MAX_LENGTH = 2147483647;
    exports.kMaxLength = K_MAX_LENGTH;
    Buffer6.TYPED_ARRAY_SUPPORT = typedArraySupport();
    !Buffer6.TYPED_ARRAY_SUPPORT && typeof console < "u" && typeof console.error == "function" && console.error(
      "This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."
    );
    function typedArraySupport() {
      try {
        let arr = new Uint8Array(1), proto = { foo: function() {
          return 42;
        } };
        return Object.setPrototypeOf(proto, Uint8Array.prototype), Object.setPrototypeOf(arr, proto), arr.foo() === 42;
      } catch {
        return !1;
      }
    }
    Object.defineProperty(Buffer6.prototype, "parent", {
      enumerable: !0,
      get: function() {
        if (Buffer6.isBuffer(this))
          return this.buffer;
      }
    });
    Object.defineProperty(Buffer6.prototype, "offset", {
      enumerable: !0,
      get: function() {
        if (Buffer6.isBuffer(this))
          return this.byteOffset;
      }
    });
    function createBuffer(length) {
      if (length > K_MAX_LENGTH)
        throw new RangeError('The value "' + length + '" is invalid for option "size"');
      let buf = new Uint8Array(length);
      return Object.setPrototypeOf(buf, Buffer6.prototype), buf;
    }
    function Buffer6(arg, encodingOrOffset, length) {
      if (typeof arg == "number") {
        if (typeof encodingOrOffset == "string")
          throw new TypeError(
            'The "string" argument must be of type string. Received type number'
          );
        return allocUnsafe(arg);
      }
      return from(arg, encodingOrOffset, length);
    }
    Buffer6.poolSize = 8192;
    function from(value, encodingOrOffset, length) {
      if (typeof value == "string")
        return fromString(value, encodingOrOffset);
      if (ArrayBuffer.isView(value))
        return fromArrayView(value);
      if (value == null)
        throw new TypeError(
          "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
        );
      if (isInstance(value, ArrayBuffer) || value && isInstance(value.buffer, ArrayBuffer) || typeof SharedArrayBuffer < "u" && (isInstance(value, SharedArrayBuffer) || value && isInstance(value.buffer, SharedArrayBuffer)))
        return fromArrayBuffer(value, encodingOrOffset, length);
      if (typeof value == "number")
        throw new TypeError(
          'The "value" argument must not be of type number. Received type number'
        );
      let valueOf = value.valueOf && value.valueOf();
      if (valueOf != null && valueOf !== value)
        return Buffer6.from(valueOf, encodingOrOffset, length);
      let b = fromObject(value);
      if (b) return b;
      if (typeof Symbol < "u" && Symbol.toPrimitive != null && typeof value[Symbol.toPrimitive] == "function")
        return Buffer6.from(value[Symbol.toPrimitive]("string"), encodingOrOffset, length);
      throw new TypeError(
        "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
      );
    }
    Buffer6.from = function(value, encodingOrOffset, length) {
      return from(value, encodingOrOffset, length);
    };
    Object.setPrototypeOf(Buffer6.prototype, Uint8Array.prototype);
    Object.setPrototypeOf(Buffer6, Uint8Array);
    function assertSize(size) {
      if (typeof size != "number")
        throw new TypeError('"size" argument must be of type number');
      if (size < 0)
        throw new RangeError('The value "' + size + '" is invalid for option "size"');
    }
    function alloc(size, fill, encoding) {
      return assertSize(size), size <= 0 ? createBuffer(size) : fill !== void 0 ? typeof encoding == "string" ? createBuffer(size).fill(fill, encoding) : createBuffer(size).fill(fill) : createBuffer(size);
    }
    Buffer6.alloc = function(size, fill, encoding) {
      return alloc(size, fill, encoding);
    };
    function allocUnsafe(size) {
      return assertSize(size), createBuffer(size < 0 ? 0 : checked(size) | 0);
    }
    Buffer6.allocUnsafe = function(size) {
      return allocUnsafe(size);
    };
    Buffer6.allocUnsafeSlow = function(size) {
      return allocUnsafe(size);
    };
    function fromString(string, encoding) {
      if ((typeof encoding != "string" || encoding === "") && (encoding = "utf8"), !Buffer6.isEncoding(encoding))
        throw new TypeError("Unknown encoding: " + encoding);
      let length = byteLength(string, encoding) | 0, buf = createBuffer(length), actual = buf.write(string, encoding);
      return actual !== length && (buf = buf.slice(0, actual)), buf;
    }
    function fromArrayLike(array) {
      let length = array.length < 0 ? 0 : checked(array.length) | 0, buf = createBuffer(length);
      for (let i = 0; i < length; i += 1)
        buf[i] = array[i] & 255;
      return buf;
    }
    function fromArrayView(arrayView) {
      if (isInstance(arrayView, Uint8Array)) {
        let copy = new Uint8Array(arrayView);
        return fromArrayBuffer(copy.buffer, copy.byteOffset, copy.byteLength);
      }
      return fromArrayLike(arrayView);
    }
    function fromArrayBuffer(array, byteOffset, length) {
      if (byteOffset < 0 || array.byteLength < byteOffset)
        throw new RangeError('"offset" is outside of buffer bounds');
      if (array.byteLength < byteOffset + (length || 0))
        throw new RangeError('"length" is outside of buffer bounds');
      let buf;
      return byteOffset === void 0 && length === void 0 ? buf = new Uint8Array(array) : length === void 0 ? buf = new Uint8Array(array, byteOffset) : buf = new Uint8Array(array, byteOffset, length), Object.setPrototypeOf(buf, Buffer6.prototype), buf;
    }
    function fromObject(obj) {
      if (Buffer6.isBuffer(obj)) {
        let len = checked(obj.length) | 0, buf = createBuffer(len);
        return buf.length === 0 || obj.copy(buf, 0, 0, len), buf;
      }
      if (obj.length !== void 0)
        return typeof obj.length != "number" || numberIsNaN(obj.length) ? createBuffer(0) : fromArrayLike(obj);
      if (obj.type === "Buffer" && Array.isArray(obj.data))
        return fromArrayLike(obj.data);
    }
    function checked(length) {
      if (length >= K_MAX_LENGTH)
        throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + K_MAX_LENGTH.toString(16) + " bytes");
      return length | 0;
    }
    function SlowBuffer(length) {
      return +length != length && (length = 0), Buffer6.alloc(+length);
    }
    Buffer6.isBuffer = function(b) {
      return b != null && b._isBuffer === !0 && b !== Buffer6.prototype;
    };
    Buffer6.compare = function(a2, b) {
      if (isInstance(a2, Uint8Array) && (a2 = Buffer6.from(a2, a2.offset, a2.byteLength)), isInstance(b, Uint8Array) && (b = Buffer6.from(b, b.offset, b.byteLength)), !Buffer6.isBuffer(a2) || !Buffer6.isBuffer(b))
        throw new TypeError(
          'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
        );
      if (a2 === b) return 0;
      let x = a2.length, y = b.length;
      for (let i = 0, len = Math.min(x, y); i < len; ++i)
        if (a2[i] !== b[i]) {
          x = a2[i], y = b[i];
          break;
        }
      return x < y ? -1 : y < x ? 1 : 0;
    };
    Buffer6.isEncoding = function(encoding) {
      switch (String(encoding).toLowerCase()) {
        case "hex":
        case "utf8":
        case "utf-8":
        case "ascii":
        case "latin1":
        case "binary":
        case "base64":
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return !0;
        default:
          return !1;
      }
    };
    Buffer6.concat = function(list, length) {
      if (!Array.isArray(list))
        throw new TypeError('"list" argument must be an Array of Buffers');
      if (list.length === 0)
        return Buffer6.alloc(0);
      let i;
      if (length === void 0)
        for (length = 0, i = 0; i < list.length; ++i)
          length += list[i].length;
      let buffer = Buffer6.allocUnsafe(length), pos = 0;
      for (i = 0; i < list.length; ++i) {
        let buf = list[i];
        if (isInstance(buf, Uint8Array))
          pos + buf.length > buffer.length ? (Buffer6.isBuffer(buf) || (buf = Buffer6.from(buf)), buf.copy(buffer, pos)) : Uint8Array.prototype.set.call(
            buffer,
            buf,
            pos
          );
        else if (Buffer6.isBuffer(buf))
          buf.copy(buffer, pos);
        else
          throw new TypeError('"list" argument must be an Array of Buffers');
        pos += buf.length;
      }
      return buffer;
    };
    function byteLength(string, encoding) {
      if (Buffer6.isBuffer(string))
        return string.length;
      if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer))
        return string.byteLength;
      if (typeof string != "string")
        throw new TypeError(
          'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof string
        );
      let len = string.length, mustMatch = arguments.length > 2 && arguments[2] === !0;
      if (!mustMatch && len === 0) return 0;
      let loweredCase = !1;
      for (; ; )
        switch (encoding) {
          case "ascii":
          case "latin1":
          case "binary":
            return len;
          case "utf8":
          case "utf-8":
            return utf8ToBytes(string).length;
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return len * 2;
          case "hex":
            return len >>> 1;
          case "base64":
            return base64ToBytes(string).length;
          default:
            if (loweredCase)
              return mustMatch ? -1 : utf8ToBytes(string).length;
            encoding = ("" + encoding).toLowerCase(), loweredCase = !0;
        }
    }
    Buffer6.byteLength = byteLength;
    function slowToString(encoding, start2, end) {
      let loweredCase = !1;
      if ((start2 === void 0 || start2 < 0) && (start2 = 0), start2 > this.length || ((end === void 0 || end > this.length) && (end = this.length), end <= 0) || (end >>>= 0, start2 >>>= 0, end <= start2))
        return "";
      for (encoding || (encoding = "utf8"); ; )
        switch (encoding) {
          case "hex":
            return hexSlice(this, start2, end);
          case "utf8":
          case "utf-8":
            return utf8Slice(this, start2, end);
          case "ascii":
            return asciiSlice(this, start2, end);
          case "latin1":
          case "binary":
            return latin1Slice(this, start2, end);
          case "base64":
            return base64Slice(this, start2, end);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return utf16leSlice(this, start2, end);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = (encoding + "").toLowerCase(), loweredCase = !0;
        }
    }
    Buffer6.prototype._isBuffer = !0;
    function swap(b, n, m) {
      let i = b[n];
      b[n] = b[m], b[m] = i;
    }
    Buffer6.prototype.swap16 = function() {
      let len = this.length;
      if (len % 2 !== 0)
        throw new RangeError("Buffer size must be a multiple of 16-bits");
      for (let i = 0; i < len; i += 2)
        swap(this, i, i + 1);
      return this;
    };
    Buffer6.prototype.swap32 = function() {
      let len = this.length;
      if (len % 4 !== 0)
        throw new RangeError("Buffer size must be a multiple of 32-bits");
      for (let i = 0; i < len; i += 4)
        swap(this, i, i + 3), swap(this, i + 1, i + 2);
      return this;
    };
    Buffer6.prototype.swap64 = function() {
      let len = this.length;
      if (len % 8 !== 0)
        throw new RangeError("Buffer size must be a multiple of 64-bits");
      for (let i = 0; i < len; i += 8)
        swap(this, i, i + 7), swap(this, i + 1, i + 6), swap(this, i + 2, i + 5), swap(this, i + 3, i + 4);
      return this;
    };
    Buffer6.prototype.toString = function() {
      let length = this.length;
      return length === 0 ? "" : arguments.length === 0 ? utf8Slice(this, 0, length) : slowToString.apply(this, arguments);
    };
    Buffer6.prototype.toLocaleString = Buffer6.prototype.toString;
    Buffer6.prototype.equals = function(b) {
      if (!Buffer6.isBuffer(b)) throw new TypeError("Argument must be a Buffer");
      return this === b ? !0 : Buffer6.compare(this, b) === 0;
    };
    Buffer6.prototype.inspect = function() {
      let str = "", max = exports.INSPECT_MAX_BYTES;
      return str = this.toString("hex", 0, max).replace(/(.{2})/g, "$1 ").trim(), this.length > max && (str += " ... "), "<Buffer " + str + ">";
    };
    customInspectSymbol && (Buffer6.prototype[customInspectSymbol] = Buffer6.prototype.inspect);
    Buffer6.prototype.compare = function(target, start2, end, thisStart, thisEnd) {
      if (isInstance(target, Uint8Array) && (target = Buffer6.from(target, target.offset, target.byteLength)), !Buffer6.isBuffer(target))
        throw new TypeError(
          'The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof target
        );
      if (start2 === void 0 && (start2 = 0), end === void 0 && (end = target ? target.length : 0), thisStart === void 0 && (thisStart = 0), thisEnd === void 0 && (thisEnd = this.length), start2 < 0 || end > target.length || thisStart < 0 || thisEnd > this.length)
        throw new RangeError("out of range index");
      if (thisStart >= thisEnd && start2 >= end)
        return 0;
      if (thisStart >= thisEnd)
        return -1;
      if (start2 >= end)
        return 1;
      if (start2 >>>= 0, end >>>= 0, thisStart >>>= 0, thisEnd >>>= 0, this === target) return 0;
      let x = thisEnd - thisStart, y = end - start2, len = Math.min(x, y), thisCopy = this.slice(thisStart, thisEnd), targetCopy = target.slice(start2, end);
      for (let i = 0; i < len; ++i)
        if (thisCopy[i] !== targetCopy[i]) {
          x = thisCopy[i], y = targetCopy[i];
          break;
        }
      return x < y ? -1 : y < x ? 1 : 0;
    };
    function bidirectionalIndexOf(buffer, val, byteOffset, encoding, dir) {
      if (buffer.length === 0) return -1;
      if (typeof byteOffset == "string" ? (encoding = byteOffset, byteOffset = 0) : byteOffset > 2147483647 ? byteOffset = 2147483647 : byteOffset < -2147483648 && (byteOffset = -2147483648), byteOffset = +byteOffset, numberIsNaN(byteOffset) && (byteOffset = dir ? 0 : buffer.length - 1), byteOffset < 0 && (byteOffset = buffer.length + byteOffset), byteOffset >= buffer.length) {
        if (dir) return -1;
        byteOffset = buffer.length - 1;
      } else if (byteOffset < 0)
        if (dir) byteOffset = 0;
        else return -1;
      if (typeof val == "string" && (val = Buffer6.from(val, encoding)), Buffer6.isBuffer(val))
        return val.length === 0 ? -1 : arrayIndexOf(buffer, val, byteOffset, encoding, dir);
      if (typeof val == "number")
        return val = val & 255, typeof Uint8Array.prototype.indexOf == "function" ? dir ? Uint8Array.prototype.indexOf.call(buffer, val, byteOffset) : Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset) : arrayIndexOf(buffer, [val], byteOffset, encoding, dir);
      throw new TypeError("val must be string, number or Buffer");
    }
    function arrayIndexOf(arr, val, byteOffset, encoding, dir) {
      let indexSize = 1, arrLength = arr.length, valLength = val.length;
      if (encoding !== void 0 && (encoding = String(encoding).toLowerCase(), encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le")) {
        if (arr.length < 2 || val.length < 2)
          return -1;
        indexSize = 2, arrLength /= 2, valLength /= 2, byteOffset /= 2;
      }
      function read(buf, i2) {
        return indexSize === 1 ? buf[i2] : buf.readUInt16BE(i2 * indexSize);
      }
      let i;
      if (dir) {
        let foundIndex = -1;
        for (i = byteOffset; i < arrLength; i++)
          if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
            if (foundIndex === -1 && (foundIndex = i), i - foundIndex + 1 === valLength) return foundIndex * indexSize;
          } else
            foundIndex !== -1 && (i -= i - foundIndex), foundIndex = -1;
      } else
        for (byteOffset + valLength > arrLength && (byteOffset = arrLength - valLength), i = byteOffset; i >= 0; i--) {
          let found = !0;
          for (let j = 0; j < valLength; j++)
            if (read(arr, i + j) !== read(val, j)) {
              found = !1;
              break;
            }
          if (found) return i;
        }
      return -1;
    }
    Buffer6.prototype.includes = function(val, byteOffset, encoding) {
      return this.indexOf(val, byteOffset, encoding) !== -1;
    };
    Buffer6.prototype.indexOf = function(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, !0);
    };
    Buffer6.prototype.lastIndexOf = function(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, !1);
    };
    function hexWrite(buf, string, offset, length) {
      offset = Number(offset) || 0;
      let remaining = buf.length - offset;
      length ? (length = Number(length), length > remaining && (length = remaining)) : length = remaining;
      let strLen = string.length;
      length > strLen / 2 && (length = strLen / 2);
      let i;
      for (i = 0; i < length; ++i) {
        let parsed = parseInt(string.substr(i * 2, 2), 16);
        if (numberIsNaN(parsed)) return i;
        buf[offset + i] = parsed;
      }
      return i;
    }
    function utf8Write(buf, string, offset, length) {
      return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
    }
    function asciiWrite(buf, string, offset, length) {
      return blitBuffer(asciiToBytes(string), buf, offset, length);
    }
    function base64Write(buf, string, offset, length) {
      return blitBuffer(base64ToBytes(string), buf, offset, length);
    }
    function ucs2Write(buf, string, offset, length) {
      return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
    }
    Buffer6.prototype.write = function(string, offset, length, encoding) {
      if (offset === void 0)
        encoding = "utf8", length = this.length, offset = 0;
      else if (length === void 0 && typeof offset == "string")
        encoding = offset, length = this.length, offset = 0;
      else if (isFinite(offset))
        offset = offset >>> 0, isFinite(length) ? (length = length >>> 0, encoding === void 0 && (encoding = "utf8")) : (encoding = length, length = void 0);
      else
        throw new Error(
          "Buffer.write(string, encoding, offset[, length]) is no longer supported"
        );
      let remaining = this.length - offset;
      if ((length === void 0 || length > remaining) && (length = remaining), string.length > 0 && (length < 0 || offset < 0) || offset > this.length)
        throw new RangeError("Attempt to write outside buffer bounds");
      encoding || (encoding = "utf8");
      let loweredCase = !1;
      for (; ; )
        switch (encoding) {
          case "hex":
            return hexWrite(this, string, offset, length);
          case "utf8":
          case "utf-8":
            return utf8Write(this, string, offset, length);
          case "ascii":
          case "latin1":
          case "binary":
            return asciiWrite(this, string, offset, length);
          case "base64":
            return base64Write(this, string, offset, length);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return ucs2Write(this, string, offset, length);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = ("" + encoding).toLowerCase(), loweredCase = !0;
        }
    };
    Buffer6.prototype.toJSON = function() {
      return {
        type: "Buffer",
        data: Array.prototype.slice.call(this._arr || this, 0)
      };
    };
    function base64Slice(buf, start2, end) {
      return start2 === 0 && end === buf.length ? base64.fromByteArray(buf) : base64.fromByteArray(buf.slice(start2, end));
    }
    function utf8Slice(buf, start2, end) {
      end = Math.min(buf.length, end);
      let res = [], i = start2;
      for (; i < end; ) {
        let firstByte = buf[i], codePoint = null, bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
        if (i + bytesPerSequence <= end) {
          let secondByte, thirdByte, fourthByte, tempCodePoint;
          switch (bytesPerSequence) {
            case 1:
              firstByte < 128 && (codePoint = firstByte);
              break;
            case 2:
              secondByte = buf[i + 1], (secondByte & 192) === 128 && (tempCodePoint = (firstByte & 31) << 6 | secondByte & 63, tempCodePoint > 127 && (codePoint = tempCodePoint));
              break;
            case 3:
              secondByte = buf[i + 1], thirdByte = buf[i + 2], (secondByte & 192) === 128 && (thirdByte & 192) === 128 && (tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63, tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343) && (codePoint = tempCodePoint));
              break;
            case 4:
              secondByte = buf[i + 1], thirdByte = buf[i + 2], fourthByte = buf[i + 3], (secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128 && (tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63, tempCodePoint > 65535 && tempCodePoint < 1114112 && (codePoint = tempCodePoint));
          }
        }
        codePoint === null ? (codePoint = 65533, bytesPerSequence = 1) : codePoint > 65535 && (codePoint -= 65536, res.push(codePoint >>> 10 & 1023 | 55296), codePoint = 56320 | codePoint & 1023), res.push(codePoint), i += bytesPerSequence;
      }
      return decodeCodePointsArray(res);
    }
    var MAX_ARGUMENTS_LENGTH = 4096;
    function decodeCodePointsArray(codePoints) {
      let len = codePoints.length;
      if (len <= MAX_ARGUMENTS_LENGTH)
        return String.fromCharCode.apply(String, codePoints);
      let res = "", i = 0;
      for (; i < len; )
        res += String.fromCharCode.apply(
          String,
          codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
        );
      return res;
    }
    function asciiSlice(buf, start2, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i = start2; i < end; ++i)
        ret += String.fromCharCode(buf[i] & 127);
      return ret;
    }
    function latin1Slice(buf, start2, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i = start2; i < end; ++i)
        ret += String.fromCharCode(buf[i]);
      return ret;
    }
    function hexSlice(buf, start2, end) {
      let len = buf.length;
      (!start2 || start2 < 0) && (start2 = 0), (!end || end < 0 || end > len) && (end = len);
      let out = "";
      for (let i = start2; i < end; ++i)
        out += hexSliceLookupTable[buf[i]];
      return out;
    }
    function utf16leSlice(buf, start2, end) {
      let bytes = buf.slice(start2, end), res = "";
      for (let i = 0; i < bytes.length - 1; i += 2)
        res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
      return res;
    }
    Buffer6.prototype.slice = function(start2, end) {
      let len = this.length;
      start2 = ~~start2, end = end === void 0 ? len : ~~end, start2 < 0 ? (start2 += len, start2 < 0 && (start2 = 0)) : start2 > len && (start2 = len), end < 0 ? (end += len, end < 0 && (end = 0)) : end > len && (end = len), end < start2 && (end = start2);
      let newBuf = this.subarray(start2, end);
      return Object.setPrototypeOf(newBuf, Buffer6.prototype), newBuf;
    };
    function checkOffset(offset, ext, length) {
      if (offset % 1 !== 0 || offset < 0) throw new RangeError("offset is not uint");
      if (offset + ext > length) throw new RangeError("Trying to access beyond buffer length");
    }
    Buffer6.prototype.readUintLE = Buffer6.prototype.readUIntLE = function(offset, byteLength2, noAssert) {
      offset = offset >>> 0, byteLength2 = byteLength2 >>> 0, noAssert || checkOffset(offset, byteLength2, this.length);
      let val = this[offset], mul = 1, i = 0;
      for (; ++i < byteLength2 && (mul *= 256); )
        val += this[offset + i] * mul;
      return val;
    };
    Buffer6.prototype.readUintBE = Buffer6.prototype.readUIntBE = function(offset, byteLength2, noAssert) {
      offset = offset >>> 0, byteLength2 = byteLength2 >>> 0, noAssert || checkOffset(offset, byteLength2, this.length);
      let val = this[offset + --byteLength2], mul = 1;
      for (; byteLength2 > 0 && (mul *= 256); )
        val += this[offset + --byteLength2] * mul;
      return val;
    };
    Buffer6.prototype.readUint8 = Buffer6.prototype.readUInt8 = function(offset, noAssert) {
      return offset = offset >>> 0, noAssert || checkOffset(offset, 1, this.length), this[offset];
    };
    Buffer6.prototype.readUint16LE = Buffer6.prototype.readUInt16LE = function(offset, noAssert) {
      return offset = offset >>> 0, noAssert || checkOffset(offset, 2, this.length), this[offset] | this[offset + 1] << 8;
    };
    Buffer6.prototype.readUint16BE = Buffer6.prototype.readUInt16BE = function(offset, noAssert) {
      return offset = offset >>> 0, noAssert || checkOffset(offset, 2, this.length), this[offset] << 8 | this[offset + 1];
    };
    Buffer6.prototype.readUint32LE = Buffer6.prototype.readUInt32LE = function(offset, noAssert) {
      return offset = offset >>> 0, noAssert || checkOffset(offset, 4, this.length), (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
    };
    Buffer6.prototype.readUint32BE = Buffer6.prototype.readUInt32BE = function(offset, noAssert) {
      return offset = offset >>> 0, noAssert || checkOffset(offset, 4, this.length), this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
    };
    Buffer6.prototype.readBigUInt64LE = defineBigIntMethod(function(offset) {
      offset = offset >>> 0, validateNumber(offset, "offset");
      let first = this[offset], last = this[offset + 7];
      (first === void 0 || last === void 0) && boundsError(offset, this.length - 8);
      let lo = first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24, hi = this[++offset] + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + last * 2 ** 24;
      return BigInt(lo) + (BigInt(hi) << BigInt(32));
    });
    Buffer6.prototype.readBigUInt64BE = defineBigIntMethod(function(offset) {
      offset = offset >>> 0, validateNumber(offset, "offset");
      let first = this[offset], last = this[offset + 7];
      (first === void 0 || last === void 0) && boundsError(offset, this.length - 8);
      let hi = first * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset], lo = this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last;
      return (BigInt(hi) << BigInt(32)) + BigInt(lo);
    });
    Buffer6.prototype.readIntLE = function(offset, byteLength2, noAssert) {
      offset = offset >>> 0, byteLength2 = byteLength2 >>> 0, noAssert || checkOffset(offset, byteLength2, this.length);
      let val = this[offset], mul = 1, i = 0;
      for (; ++i < byteLength2 && (mul *= 256); )
        val += this[offset + i] * mul;
      return mul *= 128, val >= mul && (val -= Math.pow(2, 8 * byteLength2)), val;
    };
    Buffer6.prototype.readIntBE = function(offset, byteLength2, noAssert) {
      offset = offset >>> 0, byteLength2 = byteLength2 >>> 0, noAssert || checkOffset(offset, byteLength2, this.length);
      let i = byteLength2, mul = 1, val = this[offset + --i];
      for (; i > 0 && (mul *= 256); )
        val += this[offset + --i] * mul;
      return mul *= 128, val >= mul && (val -= Math.pow(2, 8 * byteLength2)), val;
    };
    Buffer6.prototype.readInt8 = function(offset, noAssert) {
      return offset = offset >>> 0, noAssert || checkOffset(offset, 1, this.length), this[offset] & 128 ? (255 - this[offset] + 1) * -1 : this[offset];
    };
    Buffer6.prototype.readInt16LE = function(offset, noAssert) {
      offset = offset >>> 0, noAssert || checkOffset(offset, 2, this.length);
      let val = this[offset] | this[offset + 1] << 8;
      return val & 32768 ? val | 4294901760 : val;
    };
    Buffer6.prototype.readInt16BE = function(offset, noAssert) {
      offset = offset >>> 0, noAssert || checkOffset(offset, 2, this.length);
      let val = this[offset + 1] | this[offset] << 8;
      return val & 32768 ? val | 4294901760 : val;
    };
    Buffer6.prototype.readInt32LE = function(offset, noAssert) {
      return offset = offset >>> 0, noAssert || checkOffset(offset, 4, this.length), this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
    };
    Buffer6.prototype.readInt32BE = function(offset, noAssert) {
      return offset = offset >>> 0, noAssert || checkOffset(offset, 4, this.length), this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
    };
    Buffer6.prototype.readBigInt64LE = defineBigIntMethod(function(offset) {
      offset = offset >>> 0, validateNumber(offset, "offset");
      let first = this[offset], last = this[offset + 7];
      (first === void 0 || last === void 0) && boundsError(offset, this.length - 8);
      let val = this[offset + 4] + this[offset + 5] * 2 ** 8 + this[offset + 6] * 2 ** 16 + (last << 24);
      return (BigInt(val) << BigInt(32)) + BigInt(first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24);
    });
    Buffer6.prototype.readBigInt64BE = defineBigIntMethod(function(offset) {
      offset = offset >>> 0, validateNumber(offset, "offset");
      let first = this[offset], last = this[offset + 7];
      (first === void 0 || last === void 0) && boundsError(offset, this.length - 8);
      let val = (first << 24) + // Overflow
      this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      return (BigInt(val) << BigInt(32)) + BigInt(this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last);
    });
    Buffer6.prototype.readFloatLE = function(offset, noAssert) {
      return offset = offset >>> 0, noAssert || checkOffset(offset, 4, this.length), ieee754.read(this, offset, !0, 23, 4);
    };
    Buffer6.prototype.readFloatBE = function(offset, noAssert) {
      return offset = offset >>> 0, noAssert || checkOffset(offset, 4, this.length), ieee754.read(this, offset, !1, 23, 4);
    };
    Buffer6.prototype.readDoubleLE = function(offset, noAssert) {
      return offset = offset >>> 0, noAssert || checkOffset(offset, 8, this.length), ieee754.read(this, offset, !0, 52, 8);
    };
    Buffer6.prototype.readDoubleBE = function(offset, noAssert) {
      return offset = offset >>> 0, noAssert || checkOffset(offset, 8, this.length), ieee754.read(this, offset, !1, 52, 8);
    };
    function checkInt(buf, value, offset, ext, max, min) {
      if (!Buffer6.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance');
      if (value > max || value < min) throw new RangeError('"value" argument is out of bounds');
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
    }
    Buffer6.prototype.writeUintLE = Buffer6.prototype.writeUIntLE = function(value, offset, byteLength2, noAssert) {
      if (value = +value, offset = offset >>> 0, byteLength2 = byteLength2 >>> 0, !noAssert) {
        let maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let mul = 1, i = 0;
      for (this[offset] = value & 255; ++i < byteLength2 && (mul *= 256); )
        this[offset + i] = value / mul & 255;
      return offset + byteLength2;
    };
    Buffer6.prototype.writeUintBE = Buffer6.prototype.writeUIntBE = function(value, offset, byteLength2, noAssert) {
      if (value = +value, offset = offset >>> 0, byteLength2 = byteLength2 >>> 0, !noAssert) {
        let maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let i = byteLength2 - 1, mul = 1;
      for (this[offset + i] = value & 255; --i >= 0 && (mul *= 256); )
        this[offset + i] = value / mul & 255;
      return offset + byteLength2;
    };
    Buffer6.prototype.writeUint8 = Buffer6.prototype.writeUInt8 = function(value, offset, noAssert) {
      return value = +value, offset = offset >>> 0, noAssert || checkInt(this, value, offset, 1, 255, 0), this[offset] = value & 255, offset + 1;
    };
    Buffer6.prototype.writeUint16LE = Buffer6.prototype.writeUInt16LE = function(value, offset, noAssert) {
      return value = +value, offset = offset >>> 0, noAssert || checkInt(this, value, offset, 2, 65535, 0), this[offset] = value & 255, this[offset + 1] = value >>> 8, offset + 2;
    };
    Buffer6.prototype.writeUint16BE = Buffer6.prototype.writeUInt16BE = function(value, offset, noAssert) {
      return value = +value, offset = offset >>> 0, noAssert || checkInt(this, value, offset, 2, 65535, 0), this[offset] = value >>> 8, this[offset + 1] = value & 255, offset + 2;
    };
    Buffer6.prototype.writeUint32LE = Buffer6.prototype.writeUInt32LE = function(value, offset, noAssert) {
      return value = +value, offset = offset >>> 0, noAssert || checkInt(this, value, offset, 4, 4294967295, 0), this[offset + 3] = value >>> 24, this[offset + 2] = value >>> 16, this[offset + 1] = value >>> 8, this[offset] = value & 255, offset + 4;
    };
    Buffer6.prototype.writeUint32BE = Buffer6.prototype.writeUInt32BE = function(value, offset, noAssert) {
      return value = +value, offset = offset >>> 0, noAssert || checkInt(this, value, offset, 4, 4294967295, 0), this[offset] = value >>> 24, this[offset + 1] = value >>> 16, this[offset + 2] = value >>> 8, this[offset + 3] = value & 255, offset + 4;
    };
    function wrtBigUInt64LE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset++] = lo, lo = lo >> 8, buf[offset++] = lo, lo = lo >> 8, buf[offset++] = lo, lo = lo >> 8, buf[offset++] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      return buf[offset++] = hi, hi = hi >> 8, buf[offset++] = hi, hi = hi >> 8, buf[offset++] = hi, hi = hi >> 8, buf[offset++] = hi, offset;
    }
    function wrtBigUInt64BE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset + 7] = lo, lo = lo >> 8, buf[offset + 6] = lo, lo = lo >> 8, buf[offset + 5] = lo, lo = lo >> 8, buf[offset + 4] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      return buf[offset + 3] = hi, hi = hi >> 8, buf[offset + 2] = hi, hi = hi >> 8, buf[offset + 1] = hi, hi = hi >> 8, buf[offset] = hi, offset + 8;
    }
    Buffer6.prototype.writeBigUInt64LE = defineBigIntMethod(function(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    });
    Buffer6.prototype.writeBigUInt64BE = defineBigIntMethod(function(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    });
    Buffer6.prototype.writeIntLE = function(value, offset, byteLength2, noAssert) {
      if (value = +value, offset = offset >>> 0, !noAssert) {
        let limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i = 0, mul = 1, sub = 0;
      for (this[offset] = value & 255; ++i < byteLength2 && (mul *= 256); )
        value < 0 && sub === 0 && this[offset + i - 1] !== 0 && (sub = 1), this[offset + i] = (value / mul >> 0) - sub & 255;
      return offset + byteLength2;
    };
    Buffer6.prototype.writeIntBE = function(value, offset, byteLength2, noAssert) {
      if (value = +value, offset = offset >>> 0, !noAssert) {
        let limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i = byteLength2 - 1, mul = 1, sub = 0;
      for (this[offset + i] = value & 255; --i >= 0 && (mul *= 256); )
        value < 0 && sub === 0 && this[offset + i + 1] !== 0 && (sub = 1), this[offset + i] = (value / mul >> 0) - sub & 255;
      return offset + byteLength2;
    };
    Buffer6.prototype.writeInt8 = function(value, offset, noAssert) {
      return value = +value, offset = offset >>> 0, noAssert || checkInt(this, value, offset, 1, 127, -128), value < 0 && (value = 255 + value + 1), this[offset] = value & 255, offset + 1;
    };
    Buffer6.prototype.writeInt16LE = function(value, offset, noAssert) {
      return value = +value, offset = offset >>> 0, noAssert || checkInt(this, value, offset, 2, 32767, -32768), this[offset] = value & 255, this[offset + 1] = value >>> 8, offset + 2;
    };
    Buffer6.prototype.writeInt16BE = function(value, offset, noAssert) {
      return value = +value, offset = offset >>> 0, noAssert || checkInt(this, value, offset, 2, 32767, -32768), this[offset] = value >>> 8, this[offset + 1] = value & 255, offset + 2;
    };
    Buffer6.prototype.writeInt32LE = function(value, offset, noAssert) {
      return value = +value, offset = offset >>> 0, noAssert || checkInt(this, value, offset, 4, 2147483647, -2147483648), this[offset] = value & 255, this[offset + 1] = value >>> 8, this[offset + 2] = value >>> 16, this[offset + 3] = value >>> 24, offset + 4;
    };
    Buffer6.prototype.writeInt32BE = function(value, offset, noAssert) {
      return value = +value, offset = offset >>> 0, noAssert || checkInt(this, value, offset, 4, 2147483647, -2147483648), value < 0 && (value = 4294967295 + value + 1), this[offset] = value >>> 24, this[offset + 1] = value >>> 16, this[offset + 2] = value >>> 8, this[offset + 3] = value & 255, offset + 4;
    };
    Buffer6.prototype.writeBigInt64LE = defineBigIntMethod(function(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    });
    Buffer6.prototype.writeBigInt64BE = defineBigIntMethod(function(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    });
    function checkIEEE754(buf, value, offset, ext, max, min) {
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
      if (offset < 0) throw new RangeError("Index out of range");
    }
    function writeFloat(buf, value, offset, littleEndian, noAssert) {
      return value = +value, offset = offset >>> 0, noAssert || checkIEEE754(buf, value, offset, 4, 34028234663852886e22, -34028234663852886e22), ieee754.write(buf, value, offset, littleEndian, 23, 4), offset + 4;
    }
    Buffer6.prototype.writeFloatLE = function(value, offset, noAssert) {
      return writeFloat(this, value, offset, !0, noAssert);
    };
    Buffer6.prototype.writeFloatBE = function(value, offset, noAssert) {
      return writeFloat(this, value, offset, !1, noAssert);
    };
    function writeDouble(buf, value, offset, littleEndian, noAssert) {
      return value = +value, offset = offset >>> 0, noAssert || checkIEEE754(buf, value, offset, 8, 17976931348623157e292, -17976931348623157e292), ieee754.write(buf, value, offset, littleEndian, 52, 8), offset + 8;
    }
    Buffer6.prototype.writeDoubleLE = function(value, offset, noAssert) {
      return writeDouble(this, value, offset, !0, noAssert);
    };
    Buffer6.prototype.writeDoubleBE = function(value, offset, noAssert) {
      return writeDouble(this, value, offset, !1, noAssert);
    };
    Buffer6.prototype.copy = function(target, targetStart, start2, end) {
      if (!Buffer6.isBuffer(target)) throw new TypeError("argument should be a Buffer");
      if (start2 || (start2 = 0), !end && end !== 0 && (end = this.length), targetStart >= target.length && (targetStart = target.length), targetStart || (targetStart = 0), end > 0 && end < start2 && (end = start2), end === start2 || target.length === 0 || this.length === 0) return 0;
      if (targetStart < 0)
        throw new RangeError("targetStart out of bounds");
      if (start2 < 0 || start2 >= this.length) throw new RangeError("Index out of range");
      if (end < 0) throw new RangeError("sourceEnd out of bounds");
      end > this.length && (end = this.length), target.length - targetStart < end - start2 && (end = target.length - targetStart + start2);
      let len = end - start2;
      return this === target && typeof Uint8Array.prototype.copyWithin == "function" ? this.copyWithin(targetStart, start2, end) : Uint8Array.prototype.set.call(
        target,
        this.subarray(start2, end),
        targetStart
      ), len;
    };
    Buffer6.prototype.fill = function(val, start2, end, encoding) {
      if (typeof val == "string") {
        if (typeof start2 == "string" ? (encoding = start2, start2 = 0, end = this.length) : typeof end == "string" && (encoding = end, end = this.length), encoding !== void 0 && typeof encoding != "string")
          throw new TypeError("encoding must be a string");
        if (typeof encoding == "string" && !Buffer6.isEncoding(encoding))
          throw new TypeError("Unknown encoding: " + encoding);
        if (val.length === 1) {
          let code = val.charCodeAt(0);
          (encoding === "utf8" && code < 128 || encoding === "latin1") && (val = code);
        }
      } else typeof val == "number" ? val = val & 255 : typeof val == "boolean" && (val = Number(val));
      if (start2 < 0 || this.length < start2 || this.length < end)
        throw new RangeError("Out of range index");
      if (end <= start2)
        return this;
      start2 = start2 >>> 0, end = end === void 0 ? this.length : end >>> 0, val || (val = 0);
      let i;
      if (typeof val == "number")
        for (i = start2; i < end; ++i)
          this[i] = val;
      else {
        let bytes = Buffer6.isBuffer(val) ? val : Buffer6.from(val, encoding), len = bytes.length;
        if (len === 0)
          throw new TypeError('The value "' + val + '" is invalid for argument "value"');
        for (i = 0; i < end - start2; ++i)
          this[i + start2] = bytes[i % len];
      }
      return this;
    };
    var errors = {};
    function E(sym, getMessage, Base) {
      errors[sym] = class extends Base {
        constructor() {
          super(), Object.defineProperty(this, "message", {
            value: getMessage.apply(this, arguments),
            writable: !0,
            configurable: !0
          }), this.name = `${this.name} [${sym}]`, this.stack, delete this.name;
        }
        get code() {
          return sym;
        }
        set code(value) {
          Object.defineProperty(this, "code", {
            configurable: !0,
            enumerable: !0,
            value,
            writable: !0
          });
        }
        toString() {
          return `${this.name} [${sym}]: ${this.message}`;
        }
      };
    }
    E(
      "ERR_BUFFER_OUT_OF_BOUNDS",
      function(name) {
        return name ? `${name} is outside of buffer bounds` : "Attempt to access memory outside buffer bounds";
      },
      RangeError
    );
    E(
      "ERR_INVALID_ARG_TYPE",
      function(name, actual) {
        return `The "${name}" argument must be of type number. Received type ${typeof actual}`;
      },
      TypeError
    );
    E(
      "ERR_OUT_OF_RANGE",
      function(str, range, input) {
        let msg = `The value of "${str}" is out of range.`, received = input;
        return Number.isInteger(input) && Math.abs(input) > 2 ** 32 ? received = addNumericalSeparator(String(input)) : typeof input == "bigint" && (received = String(input), (input > BigInt(2) ** BigInt(32) || input < -(BigInt(2) ** BigInt(32))) && (received = addNumericalSeparator(received)), received += "n"), msg += ` It must be ${range}. Received ${received}`, msg;
      },
      RangeError
    );
    function addNumericalSeparator(val) {
      let res = "", i = val.length, start2 = val[0] === "-" ? 1 : 0;
      for (; i >= start2 + 4; i -= 3)
        res = `_${val.slice(i - 3, i)}${res}`;
      return `${val.slice(0, i)}${res}`;
    }
    function checkBounds(buf, offset, byteLength2) {
      validateNumber(offset, "offset"), (buf[offset] === void 0 || buf[offset + byteLength2] === void 0) && boundsError(offset, buf.length - (byteLength2 + 1));
    }
    function checkIntBI(value, min, max, buf, offset, byteLength2) {
      if (value > max || value < min) {
        let n = typeof min == "bigint" ? "n" : "", range;
        throw byteLength2 > 3 ? min === 0 || min === BigInt(0) ? range = `>= 0${n} and < 2${n} ** ${(byteLength2 + 1) * 8}${n}` : range = `>= -(2${n} ** ${(byteLength2 + 1) * 8 - 1}${n}) and < 2 ** ${(byteLength2 + 1) * 8 - 1}${n}` : range = `>= ${min}${n} and <= ${max}${n}`, new errors.ERR_OUT_OF_RANGE("value", range, value);
      }
      checkBounds(buf, offset, byteLength2);
    }
    function validateNumber(value, name) {
      if (typeof value != "number")
        throw new errors.ERR_INVALID_ARG_TYPE(name, "number", value);
    }
    function boundsError(value, length, type) {
      throw Math.floor(value) !== value ? (validateNumber(value, type), new errors.ERR_OUT_OF_RANGE(type || "offset", "an integer", value)) : length < 0 ? new errors.ERR_BUFFER_OUT_OF_BOUNDS() : new errors.ERR_OUT_OF_RANGE(
        type || "offset",
        `>= ${type ? 1 : 0} and <= ${length}`,
        value
      );
    }
    var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g;
    function base64clean(str) {
      if (str = str.split("=")[0], str = str.trim().replace(INVALID_BASE64_RE, ""), str.length < 2) return "";
      for (; str.length % 4 !== 0; )
        str = str + "=";
      return str;
    }
    function utf8ToBytes(string, units) {
      units = units || 1 / 0;
      let codePoint, length = string.length, leadSurrogate = null, bytes = [];
      for (let i = 0; i < length; ++i) {
        if (codePoint = string.charCodeAt(i), codePoint > 55295 && codePoint < 57344) {
          if (!leadSurrogate) {
            if (codePoint > 56319) {
              (units -= 3) > -1 && bytes.push(239, 191, 189);
              continue;
            } else if (i + 1 === length) {
              (units -= 3) > -1 && bytes.push(239, 191, 189);
              continue;
            }
            leadSurrogate = codePoint;
            continue;
          }
          if (codePoint < 56320) {
            (units -= 3) > -1 && bytes.push(239, 191, 189), leadSurrogate = codePoint;
            continue;
          }
          codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
        } else leadSurrogate && (units -= 3) > -1 && bytes.push(239, 191, 189);
        if (leadSurrogate = null, codePoint < 128) {
          if ((units -= 1) < 0) break;
          bytes.push(codePoint);
        } else if (codePoint < 2048) {
          if ((units -= 2) < 0) break;
          bytes.push(
            codePoint >> 6 | 192,
            codePoint & 63 | 128
          );
        } else if (codePoint < 65536) {
          if ((units -= 3) < 0) break;
          bytes.push(
            codePoint >> 12 | 224,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else if (codePoint < 1114112) {
          if ((units -= 4) < 0) break;
          bytes.push(
            codePoint >> 18 | 240,
            codePoint >> 12 & 63 | 128,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else
          throw new Error("Invalid code point");
      }
      return bytes;
    }
    function asciiToBytes(str) {
      let byteArray = [];
      for (let i = 0; i < str.length; ++i)
        byteArray.push(str.charCodeAt(i) & 255);
      return byteArray;
    }
    function utf16leToBytes(str, units) {
      let c, hi, lo, byteArray = [];
      for (let i = 0; i < str.length && !((units -= 2) < 0); ++i)
        c = str.charCodeAt(i), hi = c >> 8, lo = c % 256, byteArray.push(lo), byteArray.push(hi);
      return byteArray;
    }
    function base64ToBytes(str) {
      return base64.toByteArray(base64clean(str));
    }
    function blitBuffer(src, dst, offset, length) {
      let i;
      for (i = 0; i < length && !(i + offset >= dst.length || i >= src.length); ++i)
        dst[i + offset] = src[i];
      return i;
    }
    function isInstance(obj, type) {
      return obj instanceof type || obj != null && obj.constructor != null && obj.constructor.name != null && obj.constructor.name === type.name;
    }
    function numberIsNaN(obj) {
      return obj !== obj;
    }
    var hexSliceLookupTable = (function() {
      let alphabet = "0123456789abcdef", table = new Array(256);
      for (let i = 0; i < 16; ++i) {
        let i16 = i * 16;
        for (let j = 0; j < 16; ++j)
          table[i16 + j] = alphabet[i] + alphabet[j];
      }
      return table;
    })();
    function defineBigIntMethod(fn) {
      return typeof BigInt > "u" ? BufferBigIntNotDefined : fn;
    }
    function BufferBigIntNotDefined() {
      throw new Error("BigInt not supported");
    }
  }
});

// node_modules/.pnpm/events@3.3.0/node_modules/events/events.js
var require_events = __commonJS({
  "node_modules/.pnpm/events@3.3.0/node_modules/events/events.js"(exports, module) {
    "use strict";
    var R = typeof Reflect == "object" ? Reflect : null, ReflectApply = R && typeof R.apply == "function" ? R.apply : function(target, receiver, args) {
      return Function.prototype.apply.call(target, receiver, args);
    }, ReflectOwnKeys;
    R && typeof R.ownKeys == "function" ? ReflectOwnKeys = R.ownKeys : Object.getOwnPropertySymbols ? ReflectOwnKeys = function(target) {
      return Object.getOwnPropertyNames(target).concat(Object.getOwnPropertySymbols(target));
    } : ReflectOwnKeys = function(target) {
      return Object.getOwnPropertyNames(target);
    };
    function ProcessEmitWarning(warning) {
      console && console.warn && console.warn(warning);
    }
    var NumberIsNaN = Number.isNaN || function(value) {
      return value !== value;
    };
    function EventEmitter6() {
      EventEmitter6.init.call(this);
    }
    module.exports = EventEmitter6;
    module.exports.once = once;
    EventEmitter6.EventEmitter = EventEmitter6;
    EventEmitter6.prototype._events = void 0;
    EventEmitter6.prototype._eventsCount = 0;
    EventEmitter6.prototype._maxListeners = void 0;
    var defaultMaxListeners = 10;
    function checkListener(listener) {
      if (typeof listener != "function")
        throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
    }
    Object.defineProperty(EventEmitter6, "defaultMaxListeners", {
      enumerable: !0,
      get: function() {
        return defaultMaxListeners;
      },
      set: function(arg) {
        if (typeof arg != "number" || arg < 0 || NumberIsNaN(arg))
          throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + arg + ".");
        defaultMaxListeners = arg;
      }
    });
    EventEmitter6.init = function() {
      (this._events === void 0 || this._events === Object.getPrototypeOf(this)._events) && (this._events = /* @__PURE__ */ Object.create(null), this._eventsCount = 0), this._maxListeners = this._maxListeners || void 0;
    };
    EventEmitter6.prototype.setMaxListeners = function(n) {
      if (typeof n != "number" || n < 0 || NumberIsNaN(n))
        throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n + ".");
      return this._maxListeners = n, this;
    };
    function _getMaxListeners(that) {
      return that._maxListeners === void 0 ? EventEmitter6.defaultMaxListeners : that._maxListeners;
    }
    EventEmitter6.prototype.getMaxListeners = function() {
      return _getMaxListeners(this);
    };
    EventEmitter6.prototype.emit = function(type) {
      for (var args = [], i = 1; i < arguments.length; i++) args.push(arguments[i]);
      var doError = type === "error", events2 = this._events;
      if (events2 !== void 0)
        doError = doError && events2.error === void 0;
      else if (!doError)
        return !1;
      if (doError) {
        var er;
        if (args.length > 0 && (er = args[0]), er instanceof Error)
          throw er;
        var err = new Error("Unhandled error." + (er ? " (" + er.message + ")" : ""));
        throw err.context = er, err;
      }
      var handler = events2[type];
      if (handler === void 0)
        return !1;
      if (typeof handler == "function")
        ReflectApply(handler, this, args);
      else
        for (var len = handler.length, listeners = arrayClone(handler, len), i = 0; i < len; ++i)
          ReflectApply(listeners[i], this, args);
      return !0;
    };
    function _addListener(target, type, listener, prepend) {
      var m, events2, existing;
      if (checkListener(listener), events2 = target._events, events2 === void 0 ? (events2 = target._events = /* @__PURE__ */ Object.create(null), target._eventsCount = 0) : (events2.newListener !== void 0 && (target.emit(
        "newListener",
        type,
        listener.listener ? listener.listener : listener
      ), events2 = target._events), existing = events2[type]), existing === void 0)
        existing = events2[type] = listener, ++target._eventsCount;
      else if (typeof existing == "function" ? existing = events2[type] = prepend ? [listener, existing] : [existing, listener] : prepend ? existing.unshift(listener) : existing.push(listener), m = _getMaxListeners(target), m > 0 && existing.length > m && !existing.warned) {
        existing.warned = !0;
        var w = new Error("Possible EventEmitter memory leak detected. " + existing.length + " " + String(type) + " listeners added. Use emitter.setMaxListeners() to increase limit");
        w.name = "MaxListenersExceededWarning", w.emitter = target, w.type = type, w.count = existing.length, ProcessEmitWarning(w);
      }
      return target;
    }
    EventEmitter6.prototype.addListener = function(type, listener) {
      return _addListener(this, type, listener, !1);
    };
    EventEmitter6.prototype.on = EventEmitter6.prototype.addListener;
    EventEmitter6.prototype.prependListener = function(type, listener) {
      return _addListener(this, type, listener, !0);
    };
    function onceWrapper() {
      if (!this.fired)
        return this.target.removeListener(this.type, this.wrapFn), this.fired = !0, arguments.length === 0 ? this.listener.call(this.target) : this.listener.apply(this.target, arguments);
    }
    function _onceWrap(target, type, listener) {
      var state = { fired: !1, wrapFn: void 0, target, type, listener }, wrapped = onceWrapper.bind(state);
      return wrapped.listener = listener, state.wrapFn = wrapped, wrapped;
    }
    EventEmitter6.prototype.once = function(type, listener) {
      return checkListener(listener), this.on(type, _onceWrap(this, type, listener)), this;
    };
    EventEmitter6.prototype.prependOnceListener = function(type, listener) {
      return checkListener(listener), this.prependListener(type, _onceWrap(this, type, listener)), this;
    };
    EventEmitter6.prototype.removeListener = function(type, listener) {
      var list, events2, position, i, originalListener;
      if (checkListener(listener), events2 = this._events, events2 === void 0)
        return this;
      if (list = events2[type], list === void 0)
        return this;
      if (list === listener || list.listener === listener)
        --this._eventsCount === 0 ? this._events = /* @__PURE__ */ Object.create(null) : (delete events2[type], events2.removeListener && this.emit("removeListener", type, list.listener || listener));
      else if (typeof list != "function") {
        for (position = -1, i = list.length - 1; i >= 0; i--)
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener, position = i;
            break;
          }
        if (position < 0)
          return this;
        position === 0 ? list.shift() : spliceOne(list, position), list.length === 1 && (events2[type] = list[0]), events2.removeListener !== void 0 && this.emit("removeListener", type, originalListener || listener);
      }
      return this;
    };
    EventEmitter6.prototype.off = EventEmitter6.prototype.removeListener;
    EventEmitter6.prototype.removeAllListeners = function(type) {
      var listeners, events2, i;
      if (events2 = this._events, events2 === void 0)
        return this;
      if (events2.removeListener === void 0)
        return arguments.length === 0 ? (this._events = /* @__PURE__ */ Object.create(null), this._eventsCount = 0) : events2[type] !== void 0 && (--this._eventsCount === 0 ? this._events = /* @__PURE__ */ Object.create(null) : delete events2[type]), this;
      if (arguments.length === 0) {
        var keys = Object.keys(events2), key;
        for (i = 0; i < keys.length; ++i)
          key = keys[i], key !== "removeListener" && this.removeAllListeners(key);
        return this.removeAllListeners("removeListener"), this._events = /* @__PURE__ */ Object.create(null), this._eventsCount = 0, this;
      }
      if (listeners = events2[type], typeof listeners == "function")
        this.removeListener(type, listeners);
      else if (listeners !== void 0)
        for (i = listeners.length - 1; i >= 0; i--)
          this.removeListener(type, listeners[i]);
      return this;
    };
    function _listeners(target, type, unwrap) {
      var events2 = target._events;
      if (events2 === void 0)
        return [];
      var evlistener = events2[type];
      return evlistener === void 0 ? [] : typeof evlistener == "function" ? unwrap ? [evlistener.listener || evlistener] : [evlistener] : unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
    }
    EventEmitter6.prototype.listeners = function(type) {
      return _listeners(this, type, !0);
    };
    EventEmitter6.prototype.rawListeners = function(type) {
      return _listeners(this, type, !1);
    };
    EventEmitter6.listenerCount = function(emitter, type) {
      return typeof emitter.listenerCount == "function" ? emitter.listenerCount(type) : listenerCount.call(emitter, type);
    };
    EventEmitter6.prototype.listenerCount = listenerCount;
    function listenerCount(type) {
      var events2 = this._events;
      if (events2 !== void 0) {
        var evlistener = events2[type];
        if (typeof evlistener == "function")
          return 1;
        if (evlistener !== void 0)
          return evlistener.length;
      }
      return 0;
    }
    EventEmitter6.prototype.eventNames = function() {
      return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
    };
    function arrayClone(arr, n) {
      for (var copy = new Array(n), i = 0; i < n; ++i)
        copy[i] = arr[i];
      return copy;
    }
    function spliceOne(list, index) {
      for (; index + 1 < list.length; index++)
        list[index] = list[index + 1];
      list.pop();
    }
    function unwrapListeners(arr) {
      for (var ret = new Array(arr.length), i = 0; i < ret.length; ++i)
        ret[i] = arr[i].listener || arr[i];
      return ret;
    }
    function once(emitter, name) {
      return new Promise(function(resolve2, reject) {
        function errorListener(err) {
          emitter.removeListener(name, resolver), reject(err);
        }
        function resolver() {
          typeof emitter.removeListener == "function" && emitter.removeListener("error", errorListener), resolve2([].slice.call(arguments));
        }
        eventTargetAgnosticAddListener(emitter, name, resolver, { once: !0 }), name !== "error" && addErrorHandlerIfEventEmitter(emitter, errorListener, { once: !0 });
      });
    }
    function addErrorHandlerIfEventEmitter(emitter, handler, flags) {
      typeof emitter.on == "function" && eventTargetAgnosticAddListener(emitter, "error", handler, flags);
    }
    function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
      if (typeof emitter.on == "function")
        flags.once ? emitter.once(name, listener) : emitter.on(name, listener);
      else if (typeof emitter.addEventListener == "function")
        emitter.addEventListener(name, function wrapListener(arg) {
          flags.once && emitter.removeEventListener(name, wrapListener), listener(arg);
        });
      else
        throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof emitter);
    }
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/ours/primordials.js
var require_primordials = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/ours/primordials.js"(exports, module) {
    "use strict";
    var AggregateError = class extends Error {
      constructor(errors) {
        if (!Array.isArray(errors))
          throw new TypeError(`Expected input to be an Array, got ${typeof errors}`);
        let message = "";
        for (let i = 0; i < errors.length; i++)
          message += `    ${errors[i].stack}
`;
        super(message), this.name = "AggregateError", this.errors = errors;
      }
    };
    module.exports = {
      AggregateError,
      ArrayIsArray(self2) {
        return Array.isArray(self2);
      },
      ArrayPrototypeIncludes(self2, el) {
        return self2.includes(el);
      },
      ArrayPrototypeIndexOf(self2, el) {
        return self2.indexOf(el);
      },
      ArrayPrototypeJoin(self2, sep) {
        return self2.join(sep);
      },
      ArrayPrototypeMap(self2, fn) {
        return self2.map(fn);
      },
      ArrayPrototypePop(self2, el) {
        return self2.pop(el);
      },
      ArrayPrototypePush(self2, el) {
        return self2.push(el);
      },
      ArrayPrototypeSlice(self2, start2, end) {
        return self2.slice(start2, end);
      },
      Error,
      FunctionPrototypeCall(fn, thisArgs, ...args) {
        return fn.call(thisArgs, ...args);
      },
      FunctionPrototypeSymbolHasInstance(self2, instance) {
        return Function.prototype[Symbol.hasInstance].call(self2, instance);
      },
      MathFloor: Math.floor,
      Number,
      NumberIsInteger: Number.isInteger,
      NumberIsNaN: Number.isNaN,
      NumberMAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
      NumberMIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
      NumberParseInt: Number.parseInt,
      ObjectDefineProperties(self2, props) {
        return Object.defineProperties(self2, props);
      },
      ObjectDefineProperty(self2, name, prop) {
        return Object.defineProperty(self2, name, prop);
      },
      ObjectGetOwnPropertyDescriptor(self2, name) {
        return Object.getOwnPropertyDescriptor(self2, name);
      },
      ObjectKeys(obj) {
        return Object.keys(obj);
      },
      ObjectSetPrototypeOf(target, proto) {
        return Object.setPrototypeOf(target, proto);
      },
      Promise,
      PromisePrototypeCatch(self2, fn) {
        return self2.catch(fn);
      },
      PromisePrototypeThen(self2, thenFn, catchFn) {
        return self2.then(thenFn, catchFn);
      },
      PromiseReject(err) {
        return Promise.reject(err);
      },
      PromiseResolve(val) {
        return Promise.resolve(val);
      },
      ReflectApply: Reflect.apply,
      RegExpPrototypeTest(self2, value) {
        return self2.test(value);
      },
      SafeSet: Set,
      String,
      StringPrototypeSlice(self2, start2, end) {
        return self2.slice(start2, end);
      },
      StringPrototypeToLowerCase(self2) {
        return self2.toLowerCase();
      },
      StringPrototypeToUpperCase(self2) {
        return self2.toUpperCase();
      },
      StringPrototypeTrim(self2) {
        return self2.trim();
      },
      Symbol,
      SymbolFor: Symbol.for,
      SymbolAsyncIterator: Symbol.asyncIterator,
      SymbolHasInstance: Symbol.hasInstance,
      SymbolIterator: Symbol.iterator,
      SymbolDispose: Symbol.dispose || /* @__PURE__ */ Symbol("Symbol.dispose"),
      SymbolAsyncDispose: Symbol.asyncDispose || /* @__PURE__ */ Symbol("Symbol.asyncDispose"),
      TypedArrayPrototypeSet(self2, buf, len) {
        return self2.set(buf, len);
      },
      Boolean,
      Uint8Array
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/ours/util/inspect.js
var require_inspect = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/ours/util/inspect.js"(exports, module) {
    "use strict";
    module.exports = {
      format(format3, ...args) {
        return format3.replace(/%([sdifj])/g, function(...[_unused, type]) {
          let replacement = args.shift();
          return type === "f" ? replacement.toFixed(6) : type === "j" ? JSON.stringify(replacement) : type === "s" && typeof replacement == "object" ? `${replacement.constructor !== Object ? replacement.constructor.name : ""} {}`.trim() : replacement.toString();
        });
      },
      inspect(value) {
        switch (typeof value) {
          case "string":
            if (value.includes("'"))
              if (value.includes('"')) {
                if (!value.includes("`") && !value.includes("${"))
                  return `\`${value}\``;
              } else return `"${value}"`;
            return `'${value}'`;
          case "number":
            return isNaN(value) ? "NaN" : Object.is(value, -0) ? String(value) : value;
          case "bigint":
            return `${String(value)}n`;
          case "boolean":
          case "undefined":
            return String(value);
          case "object":
            return "{}";
        }
      }
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/ours/errors.js
var require_errors = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/ours/errors.js"(exports, module) {
    "use strict";
    var { format: format3, inspect: inspect2 } = require_inspect(), { AggregateError: CustomAggregateError } = require_primordials(), AggregateError = globalThis.AggregateError || CustomAggregateError, kIsNodeError = /* @__PURE__ */ Symbol("kIsNodeError"), kTypes = [
      "string",
      "function",
      "number",
      "object",
      // Accept 'Function' and 'Object' as alternative to the lower cased version.
      "Function",
      "Object",
      "boolean",
      "bigint",
      "symbol"
    ], classRegExp = /^([A-Z][a-z0-9]*)+$/, nodeInternalPrefix = "__node_internal_", codes = {};
    function assert2(value, message) {
      if (!value)
        throw new codes.ERR_INTERNAL_ASSERTION(message);
    }
    function addNumericalSeparator(val) {
      let res = "", i = val.length, start2 = val[0] === "-" ? 1 : 0;
      for (; i >= start2 + 4; i -= 3)
        res = `_${val.slice(i - 3, i)}${res}`;
      return `${val.slice(0, i)}${res}`;
    }
    function getMessage(key, msg, args) {
      if (typeof msg == "function")
        return assert2(
          msg.length <= args.length,
          // Default options do not count.
          `Code: ${key}; The provided arguments length (${args.length}) does not match the required ones (${msg.length}).`
        ), msg(...args);
      let expectedLength = (msg.match(/%[dfijoOs]/g) || []).length;
      return assert2(
        expectedLength === args.length,
        `Code: ${key}; The provided arguments length (${args.length}) does not match the required ones (${expectedLength}).`
      ), args.length === 0 ? msg : format3(msg, ...args);
    }
    function E(code, message, Base) {
      Base || (Base = Error);
      class NodeError extends Base {
        constructor(...args) {
          super(getMessage(code, message, args));
        }
        toString() {
          return `${this.name} [${code}]: ${this.message}`;
        }
      }
      Object.defineProperties(NodeError.prototype, {
        name: {
          value: Base.name,
          writable: !0,
          enumerable: !1,
          configurable: !0
        },
        toString: {
          value() {
            return `${this.name} [${code}]: ${this.message}`;
          },
          writable: !0,
          enumerable: !1,
          configurable: !0
        }
      }), NodeError.prototype.code = code, NodeError.prototype[kIsNodeError] = !0, codes[code] = NodeError;
    }
    function hideStackFrames(fn) {
      let hidden = nodeInternalPrefix + fn.name;
      return Object.defineProperty(fn, "name", {
        value: hidden
      }), fn;
    }
    function aggregateTwoErrors(innerError, outerError) {
      if (innerError && outerError && innerError !== outerError) {
        if (Array.isArray(outerError.errors))
          return outerError.errors.push(innerError), outerError;
        let err = new AggregateError([outerError, innerError], outerError.message);
        return err.code = outerError.code, err;
      }
      return innerError || outerError;
    }
    var AbortError = class extends Error {
      constructor(message = "The operation was aborted", options = void 0) {
        if (options !== void 0 && typeof options != "object")
          throw new codes.ERR_INVALID_ARG_TYPE("options", "Object", options);
        super(message, options), this.code = "ABORT_ERR", this.name = "AbortError";
      }
    };
    E("ERR_ASSERTION", "%s", Error);
    E(
      "ERR_INVALID_ARG_TYPE",
      (name, expected, actual) => {
        assert2(typeof name == "string", "'name' must be a string"), Array.isArray(expected) || (expected = [expected]);
        let msg = "The ";
        name.endsWith(" argument") ? msg += `${name} ` : msg += `"${name}" ${name.includes(".") ? "property" : "argument"} `, msg += "must be ";
        let types2 = [], instances = [], other = [];
        for (let value of expected)
          assert2(typeof value == "string", "All expected entries have to be of type string"), kTypes.includes(value) ? types2.push(value.toLowerCase()) : classRegExp.test(value) ? instances.push(value) : (assert2(value !== "object", 'The value "object" should be written as "Object"'), other.push(value));
        if (instances.length > 0) {
          let pos = types2.indexOf("object");
          pos !== -1 && (types2.splice(types2, pos, 1), instances.push("Object"));
        }
        if (types2.length > 0) {
          switch (types2.length) {
            case 1:
              msg += `of type ${types2[0]}`;
              break;
            case 2:
              msg += `one of type ${types2[0]} or ${types2[1]}`;
              break;
            default: {
              let last = types2.pop();
              msg += `one of type ${types2.join(", ")}, or ${last}`;
            }
          }
          (instances.length > 0 || other.length > 0) && (msg += " or ");
        }
        if (instances.length > 0) {
          switch (instances.length) {
            case 1:
              msg += `an instance of ${instances[0]}`;
              break;
            case 2:
              msg += `an instance of ${instances[0]} or ${instances[1]}`;
              break;
            default: {
              let last = instances.pop();
              msg += `an instance of ${instances.join(", ")}, or ${last}`;
            }
          }
          other.length > 0 && (msg += " or ");
        }
        switch (other.length) {
          case 0:
            break;
          case 1:
            other[0].toLowerCase() !== other[0] && (msg += "an "), msg += `${other[0]}`;
            break;
          case 2:
            msg += `one of ${other[0]} or ${other[1]}`;
            break;
          default: {
            let last = other.pop();
            msg += `one of ${other.join(", ")}, or ${last}`;
          }
        }
        if (actual == null)
          msg += `. Received ${actual}`;
        else if (typeof actual == "function" && actual.name)
          msg += `. Received function ${actual.name}`;
        else if (typeof actual == "object") {
          var _actual$constructor;
          if ((_actual$constructor = actual.constructor) !== null && _actual$constructor !== void 0 && _actual$constructor.name)
            msg += `. Received an instance of ${actual.constructor.name}`;
          else {
            let inspected = inspect2(actual, {
              depth: -1
            });
            msg += `. Received ${inspected}`;
          }
        } else {
          let inspected = inspect2(actual, {
            colors: !1
          });
          inspected.length > 25 && (inspected = `${inspected.slice(0, 25)}...`), msg += `. Received type ${typeof actual} (${inspected})`;
        }
        return msg;
      },
      TypeError
    );
    E(
      "ERR_INVALID_ARG_VALUE",
      (name, value, reason = "is invalid") => {
        let inspected = inspect2(value);
        return inspected.length > 128 && (inspected = inspected.slice(0, 128) + "..."), `The ${name.includes(".") ? "property" : "argument"} '${name}' ${reason}. Received ${inspected}`;
      },
      TypeError
    );
    E(
      "ERR_INVALID_RETURN_VALUE",
      (input, name, value) => {
        var _value$constructor;
        let type = value != null && (_value$constructor = value.constructor) !== null && _value$constructor !== void 0 && _value$constructor.name ? `instance of ${value.constructor.name}` : `type ${typeof value}`;
        return `Expected ${input} to be returned from the "${name}" function but got ${type}.`;
      },
      TypeError
    );
    E(
      "ERR_MISSING_ARGS",
      (...args) => {
        assert2(args.length > 0, "At least one arg needs to be specified");
        let msg, len = args.length;
        switch (args = (Array.isArray(args) ? args : [args]).map((a2) => `"${a2}"`).join(" or "), len) {
          case 1:
            msg += `The ${args[0]} argument`;
            break;
          case 2:
            msg += `The ${args[0]} and ${args[1]} arguments`;
            break;
          default:
            {
              let last = args.pop();
              msg += `The ${args.join(", ")}, and ${last} arguments`;
            }
            break;
        }
        return `${msg} must be specified`;
      },
      TypeError
    );
    E(
      "ERR_OUT_OF_RANGE",
      (str, range, input) => {
        assert2(range, 'Missing "range" argument');
        let received;
        if (Number.isInteger(input) && Math.abs(input) > 2 ** 32)
          received = addNumericalSeparator(String(input));
        else if (typeof input == "bigint") {
          received = String(input);
          let limit = BigInt(2) ** BigInt(32);
          (input > limit || input < -limit) && (received = addNumericalSeparator(received)), received += "n";
        } else
          received = inspect2(input);
        return `The value of "${str}" is out of range. It must be ${range}. Received ${received}`;
      },
      RangeError
    );
    E("ERR_MULTIPLE_CALLBACK", "Callback called multiple times", Error);
    E("ERR_METHOD_NOT_IMPLEMENTED", "The %s method is not implemented", Error);
    E("ERR_STREAM_ALREADY_FINISHED", "Cannot call %s after a stream was finished", Error);
    E("ERR_STREAM_CANNOT_PIPE", "Cannot pipe, not readable", Error);
    E("ERR_STREAM_DESTROYED", "Cannot call %s after a stream was destroyed", Error);
    E("ERR_STREAM_NULL_VALUES", "May not write null values to stream", TypeError);
    E("ERR_STREAM_PREMATURE_CLOSE", "Premature close", Error);
    E("ERR_STREAM_PUSH_AFTER_EOF", "stream.push() after EOF", Error);
    E("ERR_STREAM_UNSHIFT_AFTER_END_EVENT", "stream.unshift() after end event", Error);
    E("ERR_STREAM_WRITE_AFTER_END", "write after end", Error);
    E("ERR_UNKNOWN_ENCODING", "Unknown encoding: %s", TypeError);
    module.exports = {
      AbortError,
      aggregateTwoErrors: hideStackFrames(aggregateTwoErrors),
      hideStackFrames,
      codes
    };
  }
});

// src/node/shims/abort-controller.cjs
var require_abort_controller = __commonJS({
  "src/node/shims/abort-controller.cjs"(exports, module) {
    module.exports = { AbortController: globalThis.AbortController, AbortSignal: globalThis.AbortSignal };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/ours/util.js
var require_util = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/ours/util.js"(exports, module) {
    "use strict";
    var bufferModule = require_buffer(), { format: format3, inspect: inspect2 } = require_inspect(), {
      codes: { ERR_INVALID_ARG_TYPE }
    } = require_errors(), { kResistStopPropagation, AggregateError, SymbolDispose } = require_primordials(), AbortSignal = globalThis.AbortSignal || require_abort_controller().AbortSignal, AbortController2 = globalThis.AbortController || require_abort_controller().AbortController, AsyncFunction = Object.getPrototypeOf(async function() {
    }).constructor, Blob2 = globalThis.Blob || bufferModule.Blob, isBlob = typeof Blob2 < "u" ? function(b) {
      return b instanceof Blob2;
    } : function(b) {
      return !1;
    }, validateAbortSignal = (signal, name) => {
      if (signal !== void 0 && (signal === null || typeof signal != "object" || !("aborted" in signal)))
        throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
    }, validateFunction = (value, name) => {
      if (typeof value != "function")
        throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
    };
    module.exports = {
      AggregateError,
      kEmptyObject: Object.freeze({}),
      once(callback) {
        let called = !1;
        return function(...args) {
          called || (called = !0, callback.apply(this, args));
        };
      },
      createDeferredPromise: function() {
        let resolve2, reject;
        return {
          promise: new Promise((res, rej) => {
            resolve2 = res, reject = rej;
          }),
          resolve: resolve2,
          reject
        };
      },
      promisify(fn) {
        return new Promise((resolve2, reject) => {
          fn((err, ...args) => err ? reject(err) : resolve2(...args));
        });
      },
      debuglog() {
        return function() {
        };
      },
      format: format3,
      inspect: inspect2,
      types: {
        isAsyncFunction(fn) {
          return fn instanceof AsyncFunction;
        },
        isArrayBufferView(arr) {
          return ArrayBuffer.isView(arr);
        }
      },
      isBlob,
      deprecate(fn, message) {
        return fn;
      },
      addAbortListener: require_events().addAbortListener || function(signal, listener) {
        if (signal === void 0)
          throw new ERR_INVALID_ARG_TYPE("signal", "AbortSignal", signal);
        validateAbortSignal(signal, "signal"), validateFunction(listener, "listener");
        let removeEventListener;
        return signal.aborted ? queueMicrotask(() => listener()) : (signal.addEventListener("abort", listener, {
          __proto__: null,
          once: !0,
          [kResistStopPropagation]: !0
        }), removeEventListener = () => {
          signal.removeEventListener("abort", listener);
        }), {
          __proto__: null,
          [SymbolDispose]() {
            var _removeEventListener;
            (_removeEventListener = removeEventListener) === null || _removeEventListener === void 0 || _removeEventListener();
          }
        };
      },
      AbortSignalAny: AbortSignal.any || function(signals) {
        if (signals.length === 1)
          return signals[0];
        let ac = new AbortController2(), abort = () => ac.abort();
        return signals.forEach((signal) => {
          validateAbortSignal(signal, "signals"), signal.addEventListener("abort", abort, {
            once: !0
          });
        }), ac.signal.addEventListener(
          "abort",
          () => {
            signals.forEach((signal) => signal.removeEventListener("abort", abort));
          },
          {
            once: !0
          }
        ), ac.signal;
      }
    };
    module.exports.promisify.custom = /* @__PURE__ */ Symbol.for("nodejs.util.promisify.custom");
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/validators.js
var require_validators = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/validators.js"(exports, module) {
    "use strict";
    var {
      ArrayIsArray,
      ArrayPrototypeIncludes,
      ArrayPrototypeJoin,
      ArrayPrototypeMap,
      NumberIsInteger,
      NumberIsNaN,
      NumberMAX_SAFE_INTEGER,
      NumberMIN_SAFE_INTEGER,
      NumberParseInt,
      ObjectPrototypeHasOwnProperty,
      RegExpPrototypeExec,
      String: String2,
      StringPrototypeToUpperCase,
      StringPrototypeTrim
    } = require_primordials(), {
      hideStackFrames,
      codes: { ERR_SOCKET_BAD_PORT, ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE, ERR_OUT_OF_RANGE, ERR_UNKNOWN_SIGNAL }
    } = require_errors(), { normalizeEncoding } = require_util(), { isAsyncFunction, isArrayBufferView } = require_util().types, signals = {};
    function isInt32(value) {
      return value === (value | 0);
    }
    function isUint32(value) {
      return value === value >>> 0;
    }
    var octalReg = /^[0-7]+$/, modeDesc = "must be a 32-bit unsigned integer or an octal string";
    function parseFileMode(value, name, def) {
      if (typeof value > "u" && (value = def), typeof value == "string") {
        if (RegExpPrototypeExec(octalReg, value) === null)
          throw new ERR_INVALID_ARG_VALUE(name, value, modeDesc);
        value = NumberParseInt(value, 8);
      }
      return validateUint32(value, name), value;
    }
    var validateInteger = hideStackFrames((value, name, min = NumberMIN_SAFE_INTEGER, max = NumberMAX_SAFE_INTEGER) => {
      if (typeof value != "number") throw new ERR_INVALID_ARG_TYPE(name, "number", value);
      if (!NumberIsInteger(value)) throw new ERR_OUT_OF_RANGE(name, "an integer", value);
      if (value < min || value > max) throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
    }), validateInt32 = hideStackFrames((value, name, min = -2147483648, max = 2147483647) => {
      if (typeof value != "number")
        throw new ERR_INVALID_ARG_TYPE(name, "number", value);
      if (!NumberIsInteger(value))
        throw new ERR_OUT_OF_RANGE(name, "an integer", value);
      if (value < min || value > max)
        throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
    }), validateUint32 = hideStackFrames((value, name, positive = !1) => {
      if (typeof value != "number")
        throw new ERR_INVALID_ARG_TYPE(name, "number", value);
      if (!NumberIsInteger(value))
        throw new ERR_OUT_OF_RANGE(name, "an integer", value);
      let min = positive ? 1 : 0, max = 4294967295;
      if (value < min || value > max)
        throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
    });
    function validateString(value, name) {
      if (typeof value != "string") throw new ERR_INVALID_ARG_TYPE(name, "string", value);
    }
    function validateNumber(value, name, min = void 0, max) {
      if (typeof value != "number") throw new ERR_INVALID_ARG_TYPE(name, "number", value);
      if (min != null && value < min || max != null && value > max || (min != null || max != null) && NumberIsNaN(value))
        throw new ERR_OUT_OF_RANGE(
          name,
          `${min != null ? `>= ${min}` : ""}${min != null && max != null ? " && " : ""}${max != null ? `<= ${max}` : ""}`,
          value
        );
    }
    var validateOneOf = hideStackFrames((value, name, oneOf) => {
      if (!ArrayPrototypeIncludes(oneOf, value)) {
        let reason = "must be one of: " + ArrayPrototypeJoin(
          ArrayPrototypeMap(oneOf, (v) => typeof v == "string" ? `'${v}'` : String2(v)),
          ", "
        );
        throw new ERR_INVALID_ARG_VALUE(name, value, reason);
      }
    });
    function validateBoolean(value, name) {
      if (typeof value != "boolean") throw new ERR_INVALID_ARG_TYPE(name, "boolean", value);
    }
    function getOwnPropertyValueOrDefault(options, key, defaultValue) {
      return options == null || !ObjectPrototypeHasOwnProperty(options, key) ? defaultValue : options[key];
    }
    var validateObject = hideStackFrames((value, name, options = null) => {
      let allowArray = getOwnPropertyValueOrDefault(options, "allowArray", !1), allowFunction = getOwnPropertyValueOrDefault(options, "allowFunction", !1);
      if (!getOwnPropertyValueOrDefault(options, "nullable", !1) && value === null || !allowArray && ArrayIsArray(value) || typeof value != "object" && (!allowFunction || typeof value != "function"))
        throw new ERR_INVALID_ARG_TYPE(name, "Object", value);
    }), validateDictionary = hideStackFrames((value, name) => {
      if (value != null && typeof value != "object" && typeof value != "function")
        throw new ERR_INVALID_ARG_TYPE(name, "a dictionary", value);
    }), validateArray = hideStackFrames((value, name, minLength = 0) => {
      if (!ArrayIsArray(value))
        throw new ERR_INVALID_ARG_TYPE(name, "Array", value);
      if (value.length < minLength) {
        let reason = `must be longer than ${minLength}`;
        throw new ERR_INVALID_ARG_VALUE(name, value, reason);
      }
    });
    function validateStringArray(value, name) {
      validateArray(value, name);
      for (let i = 0; i < value.length; i++)
        validateString(value[i], `${name}[${i}]`);
    }
    function validateBooleanArray(value, name) {
      validateArray(value, name);
      for (let i = 0; i < value.length; i++)
        validateBoolean(value[i], `${name}[${i}]`);
    }
    function validateAbortSignalArray(value, name) {
      validateArray(value, name);
      for (let i = 0; i < value.length; i++) {
        let signal = value[i], indexedName = `${name}[${i}]`;
        if (signal == null)
          throw new ERR_INVALID_ARG_TYPE(indexedName, "AbortSignal", signal);
        validateAbortSignal(signal, indexedName);
      }
    }
    function validateSignalName(signal, name = "signal") {
      if (validateString(signal, name), signals[signal] === void 0)
        throw signals[StringPrototypeToUpperCase(signal)] !== void 0 ? new ERR_UNKNOWN_SIGNAL(signal + " (signals must use all capital letters)") : new ERR_UNKNOWN_SIGNAL(signal);
    }
    var validateBuffer = hideStackFrames((buffer, name = "buffer") => {
      if (!isArrayBufferView(buffer))
        throw new ERR_INVALID_ARG_TYPE(name, ["Buffer", "TypedArray", "DataView"], buffer);
    });
    function validateEncoding(data, encoding) {
      let normalizedEncoding = normalizeEncoding(encoding), length = data.length;
      if (normalizedEncoding === "hex" && length % 2 !== 0)
        throw new ERR_INVALID_ARG_VALUE("encoding", encoding, `is invalid for data of length ${length}`);
    }
    function validatePort(port, name = "Port", allowZero = !0) {
      if (typeof port != "number" && typeof port != "string" || typeof port == "string" && StringPrototypeTrim(port).length === 0 || +port !== +port >>> 0 || port > 65535 || port === 0 && !allowZero)
        throw new ERR_SOCKET_BAD_PORT(name, port, allowZero);
      return port | 0;
    }
    var validateAbortSignal = hideStackFrames((signal, name) => {
      if (signal !== void 0 && (signal === null || typeof signal != "object" || !("aborted" in signal)))
        throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
    }), validateFunction = hideStackFrames((value, name) => {
      if (typeof value != "function") throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
    }), validatePlainFunction = hideStackFrames((value, name) => {
      if (typeof value != "function" || isAsyncFunction(value)) throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
    }), validateUndefined = hideStackFrames((value, name) => {
      if (value !== void 0) throw new ERR_INVALID_ARG_TYPE(name, "undefined", value);
    });
    function validateUnion(value, name, union) {
      if (!ArrayPrototypeIncludes(union, value))
        throw new ERR_INVALID_ARG_TYPE(name, `('${ArrayPrototypeJoin(union, "|")}')`, value);
    }
    var linkValueRegExp = /^(?:<[^>]*>)(?:\s*;\s*[^;"\s]+(?:=(")?[^;"\s]*\1)?)*$/;
    function validateLinkHeaderFormat(value, name) {
      if (typeof value > "u" || !RegExpPrototypeExec(linkValueRegExp, value))
        throw new ERR_INVALID_ARG_VALUE(
          name,
          value,
          'must be an array or string of format "</styles.css>; rel=preload; as=style"'
        );
    }
    function validateLinkHeaderValue(hints) {
      if (typeof hints == "string")
        return validateLinkHeaderFormat(hints, "hints"), hints;
      if (ArrayIsArray(hints)) {
        let hintsLength = hints.length, result = "";
        if (hintsLength === 0)
          return result;
        for (let i = 0; i < hintsLength; i++) {
          let link = hints[i];
          validateLinkHeaderFormat(link, "hints"), result += link, i !== hintsLength - 1 && (result += ", ");
        }
        return result;
      }
      throw new ERR_INVALID_ARG_VALUE(
        "hints",
        hints,
        'must be an array or string of format "</styles.css>; rel=preload; as=style"'
      );
    }
    module.exports = {
      isInt32,
      isUint32,
      parseFileMode,
      validateArray,
      validateStringArray,
      validateBooleanArray,
      validateAbortSignalArray,
      validateBoolean,
      validateBuffer,
      validateDictionary,
      validateEncoding,
      validateFunction,
      validateInt32,
      validateInteger,
      validateNumber,
      validateObject,
      validateOneOf,
      validatePlainFunction,
      validatePort,
      validateSignalName,
      validateString,
      validateUint32,
      validateUndefined,
      validateUnion,
      validateAbortSignal,
      validateLinkHeaderValue
    };
  }
});

// src/node/shims/process.cjs
var require_process = __commonJS({
  "src/node/shims/process.cjs"(exports, module) {
    module.exports = new Proxy({}, {
      get(_t, k) {
        let real = globalThis.process;
        if (real) return real[k];
        if (k === "nextTick") return (fn, ...a2) => queueMicrotask(() => fn(...a2));
        if (k === "env") return {};
      }
    });
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/utils.js
var require_utils = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/utils.js"(exports, module) {
    "use strict";
    var { SymbolAsyncIterator, SymbolIterator, SymbolFor } = require_primordials(), kIsDestroyed = SymbolFor("nodejs.stream.destroyed"), kIsErrored = SymbolFor("nodejs.stream.errored"), kIsReadable = SymbolFor("nodejs.stream.readable"), kIsWritable = SymbolFor("nodejs.stream.writable"), kIsDisturbed = SymbolFor("nodejs.stream.disturbed"), kIsClosedPromise = SymbolFor("nodejs.webstream.isClosedPromise"), kControllerErrorFunction = SymbolFor("nodejs.webstream.controllerErrorFunction");
    function isReadableNodeStream(obj, strict = !1) {
      var _obj$_readableState;
      return !!(obj && typeof obj.pipe == "function" && typeof obj.on == "function" && (!strict || typeof obj.pause == "function" && typeof obj.resume == "function") && (!obj._writableState || ((_obj$_readableState = obj._readableState) === null || _obj$_readableState === void 0 ? void 0 : _obj$_readableState.readable) !== !1) && // Duplex
      (!obj._writableState || obj._readableState));
    }
    function isWritableNodeStream(obj) {
      var _obj$_writableState;
      return !!(obj && typeof obj.write == "function" && typeof obj.on == "function" && (!obj._readableState || ((_obj$_writableState = obj._writableState) === null || _obj$_writableState === void 0 ? void 0 : _obj$_writableState.writable) !== !1));
    }
    function isDuplexNodeStream(obj) {
      return !!(obj && typeof obj.pipe == "function" && obj._readableState && typeof obj.on == "function" && typeof obj.write == "function");
    }
    function isNodeStream(obj) {
      return obj && (obj._readableState || obj._writableState || typeof obj.write == "function" && typeof obj.on == "function" || typeof obj.pipe == "function" && typeof obj.on == "function");
    }
    function isReadableStream(obj) {
      return !!(obj && !isNodeStream(obj) && typeof obj.pipeThrough == "function" && typeof obj.getReader == "function" && typeof obj.cancel == "function");
    }
    function isWritableStream(obj) {
      return !!(obj && !isNodeStream(obj) && typeof obj.getWriter == "function" && typeof obj.abort == "function");
    }
    function isTransformStream(obj) {
      return !!(obj && !isNodeStream(obj) && typeof obj.readable == "object" && typeof obj.writable == "object");
    }
    function isWebStream(obj) {
      return isReadableStream(obj) || isWritableStream(obj) || isTransformStream(obj);
    }
    function isIterable(obj, isAsync) {
      return obj == null ? !1 : isAsync === !0 ? typeof obj[SymbolAsyncIterator] == "function" : isAsync === !1 ? typeof obj[SymbolIterator] == "function" : typeof obj[SymbolAsyncIterator] == "function" || typeof obj[SymbolIterator] == "function";
    }
    function isDestroyed(stream) {
      if (!isNodeStream(stream)) return null;
      let wState = stream._writableState, rState = stream._readableState, state = wState || rState;
      return !!(stream.destroyed || stream[kIsDestroyed] || state != null && state.destroyed);
    }
    function isWritableEnded(stream) {
      if (!isWritableNodeStream(stream)) return null;
      if (stream.writableEnded === !0) return !0;
      let wState = stream._writableState;
      return wState != null && wState.errored ? !1 : typeof wState?.ended != "boolean" ? null : wState.ended;
    }
    function isWritableFinished(stream, strict) {
      if (!isWritableNodeStream(stream)) return null;
      if (stream.writableFinished === !0) return !0;
      let wState = stream._writableState;
      return wState != null && wState.errored ? !1 : typeof wState?.finished != "boolean" ? null : !!(wState.finished || strict === !1 && wState.ended === !0 && wState.length === 0);
    }
    function isReadableEnded(stream) {
      if (!isReadableNodeStream(stream)) return null;
      if (stream.readableEnded === !0) return !0;
      let rState = stream._readableState;
      return !rState || rState.errored ? !1 : typeof rState?.ended != "boolean" ? null : rState.ended;
    }
    function isReadableFinished(stream, strict) {
      if (!isReadableNodeStream(stream)) return null;
      let rState = stream._readableState;
      return rState != null && rState.errored ? !1 : typeof rState?.endEmitted != "boolean" ? null : !!(rState.endEmitted || strict === !1 && rState.ended === !0 && rState.length === 0);
    }
    function isReadable(stream) {
      return stream && stream[kIsReadable] != null ? stream[kIsReadable] : typeof stream?.readable != "boolean" ? null : isDestroyed(stream) ? !1 : isReadableNodeStream(stream) && stream.readable && !isReadableFinished(stream);
    }
    function isWritable(stream) {
      return stream && stream[kIsWritable] != null ? stream[kIsWritable] : typeof stream?.writable != "boolean" ? null : isDestroyed(stream) ? !1 : isWritableNodeStream(stream) && stream.writable && !isWritableEnded(stream);
    }
    function isFinished(stream, opts) {
      return isNodeStream(stream) ? isDestroyed(stream) ? !0 : !(opts?.readable !== !1 && isReadable(stream) || opts?.writable !== !1 && isWritable(stream)) : null;
    }
    function isWritableErrored(stream) {
      var _stream$_writableStat, _stream$_writableStat2;
      return isNodeStream(stream) ? stream.writableErrored ? stream.writableErrored : (_stream$_writableStat = (_stream$_writableStat2 = stream._writableState) === null || _stream$_writableStat2 === void 0 ? void 0 : _stream$_writableStat2.errored) !== null && _stream$_writableStat !== void 0 ? _stream$_writableStat : null : null;
    }
    function isReadableErrored(stream) {
      var _stream$_readableStat, _stream$_readableStat2;
      return isNodeStream(stream) ? stream.readableErrored ? stream.readableErrored : (_stream$_readableStat = (_stream$_readableStat2 = stream._readableState) === null || _stream$_readableStat2 === void 0 ? void 0 : _stream$_readableStat2.errored) !== null && _stream$_readableStat !== void 0 ? _stream$_readableStat : null : null;
    }
    function isClosed(stream) {
      if (!isNodeStream(stream))
        return null;
      if (typeof stream.closed == "boolean")
        return stream.closed;
      let wState = stream._writableState, rState = stream._readableState;
      return typeof wState?.closed == "boolean" || typeof rState?.closed == "boolean" ? wState?.closed || rState?.closed : typeof stream._closed == "boolean" && isOutgoingMessage(stream) ? stream._closed : null;
    }
    function isOutgoingMessage(stream) {
      return typeof stream._closed == "boolean" && typeof stream._defaultKeepAlive == "boolean" && typeof stream._removedConnection == "boolean" && typeof stream._removedContLen == "boolean";
    }
    function isServerResponse(stream) {
      return typeof stream._sent100 == "boolean" && isOutgoingMessage(stream);
    }
    function isServerRequest(stream) {
      var _stream$req;
      return typeof stream._consuming == "boolean" && typeof stream._dumped == "boolean" && ((_stream$req = stream.req) === null || _stream$req === void 0 ? void 0 : _stream$req.upgradeOrConnect) === void 0;
    }
    function willEmitClose(stream) {
      if (!isNodeStream(stream)) return null;
      let wState = stream._writableState, rState = stream._readableState, state = wState || rState;
      return !state && isServerResponse(stream) || !!(state && state.autoDestroy && state.emitClose && state.closed === !1);
    }
    function isDisturbed(stream) {
      var _stream$kIsDisturbed;
      return !!(stream && ((_stream$kIsDisturbed = stream[kIsDisturbed]) !== null && _stream$kIsDisturbed !== void 0 ? _stream$kIsDisturbed : stream.readableDidRead || stream.readableAborted));
    }
    function isErrored(stream) {
      var _ref, _ref2, _ref3, _ref4, _ref5, _stream$kIsErrored, _stream$_readableStat3, _stream$_writableStat3, _stream$_readableStat4, _stream$_writableStat4;
      return !!(stream && ((_ref = (_ref2 = (_ref3 = (_ref4 = (_ref5 = (_stream$kIsErrored = stream[kIsErrored]) !== null && _stream$kIsErrored !== void 0 ? _stream$kIsErrored : stream.readableErrored) !== null && _ref5 !== void 0 ? _ref5 : stream.writableErrored) !== null && _ref4 !== void 0 ? _ref4 : (_stream$_readableStat3 = stream._readableState) === null || _stream$_readableStat3 === void 0 ? void 0 : _stream$_readableStat3.errorEmitted) !== null && _ref3 !== void 0 ? _ref3 : (_stream$_writableStat3 = stream._writableState) === null || _stream$_writableStat3 === void 0 ? void 0 : _stream$_writableStat3.errorEmitted) !== null && _ref2 !== void 0 ? _ref2 : (_stream$_readableStat4 = stream._readableState) === null || _stream$_readableStat4 === void 0 ? void 0 : _stream$_readableStat4.errored) !== null && _ref !== void 0 ? _ref : !((_stream$_writableStat4 = stream._writableState) === null || _stream$_writableStat4 === void 0) && _stream$_writableStat4.errored));
    }
    module.exports = {
      isDestroyed,
      kIsDestroyed,
      isDisturbed,
      kIsDisturbed,
      isErrored,
      kIsErrored,
      isReadable,
      kIsReadable,
      kIsClosedPromise,
      kControllerErrorFunction,
      kIsWritable,
      isClosed,
      isDuplexNodeStream,
      isFinished,
      isIterable,
      isReadableNodeStream,
      isReadableStream,
      isReadableEnded,
      isReadableFinished,
      isReadableErrored,
      isNodeStream,
      isWebStream,
      isWritable,
      isWritableNodeStream,
      isWritableStream,
      isWritableEnded,
      isWritableFinished,
      isWritableErrored,
      isServerRequest,
      isServerResponse,
      willEmitClose,
      isTransformStream
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/end-of-stream.js
var require_end_of_stream = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/end-of-stream.js"(exports, module) {
    "use strict";
    var process = require_process(), { AbortError, codes } = require_errors(), { ERR_INVALID_ARG_TYPE, ERR_STREAM_PREMATURE_CLOSE } = codes, { kEmptyObject, once } = require_util(), { validateAbortSignal, validateFunction, validateObject, validateBoolean } = require_validators(), { Promise: Promise2, PromisePrototypeThen, SymbolDispose } = require_primordials(), {
      isClosed,
      isReadable,
      isReadableNodeStream,
      isReadableStream,
      isReadableFinished,
      isReadableErrored,
      isWritable,
      isWritableNodeStream,
      isWritableStream,
      isWritableFinished,
      isWritableErrored,
      isNodeStream,
      willEmitClose: _willEmitClose,
      kIsClosedPromise
    } = require_utils(), addAbortListener;
    function isRequest(stream) {
      return stream.setHeader && typeof stream.abort == "function";
    }
    var nop = () => {
    };
    function eos(stream, options, callback) {
      var _options$readable, _options$writable;
      if (arguments.length === 2 ? (callback = options, options = kEmptyObject) : options == null ? options = kEmptyObject : validateObject(options, "options"), validateFunction(callback, "callback"), validateAbortSignal(options.signal, "options.signal"), callback = once(callback), isReadableStream(stream) || isWritableStream(stream))
        return eosWeb(stream, options, callback);
      if (!isNodeStream(stream))
        throw new ERR_INVALID_ARG_TYPE("stream", ["ReadableStream", "WritableStream", "Stream"], stream);
      let readable = (_options$readable = options.readable) !== null && _options$readable !== void 0 ? _options$readable : isReadableNodeStream(stream), writable = (_options$writable = options.writable) !== null && _options$writable !== void 0 ? _options$writable : isWritableNodeStream(stream), wState = stream._writableState, rState = stream._readableState, onlegacyfinish = () => {
        stream.writable || onfinish();
      }, willEmitClose = _willEmitClose(stream) && isReadableNodeStream(stream) === readable && isWritableNodeStream(stream) === writable, writableFinished = isWritableFinished(stream, !1), onfinish = () => {
        writableFinished = !0, stream.destroyed && (willEmitClose = !1), !(willEmitClose && (!stream.readable || readable)) && (!readable || readableFinished) && callback.call(stream);
      }, readableFinished = isReadableFinished(stream, !1), onend = () => {
        readableFinished = !0, stream.destroyed && (willEmitClose = !1), !(willEmitClose && (!stream.writable || writable)) && (!writable || writableFinished) && callback.call(stream);
      }, onerror = (err) => {
        callback.call(stream, err);
      }, closed = isClosed(stream), onclose = () => {
        closed = !0;
        let errored = isWritableErrored(stream) || isReadableErrored(stream);
        if (errored && typeof errored != "boolean")
          return callback.call(stream, errored);
        if (readable && !readableFinished && isReadableNodeStream(stream, !0) && !isReadableFinished(stream, !1))
          return callback.call(stream, new ERR_STREAM_PREMATURE_CLOSE());
        if (writable && !writableFinished && !isWritableFinished(stream, !1))
          return callback.call(stream, new ERR_STREAM_PREMATURE_CLOSE());
        callback.call(stream);
      }, onclosed = () => {
        closed = !0;
        let errored = isWritableErrored(stream) || isReadableErrored(stream);
        if (errored && typeof errored != "boolean")
          return callback.call(stream, errored);
        callback.call(stream);
      }, onrequest = () => {
        stream.req.on("finish", onfinish);
      };
      isRequest(stream) ? (stream.on("complete", onfinish), willEmitClose || stream.on("abort", onclose), stream.req ? onrequest() : stream.on("request", onrequest)) : writable && !wState && (stream.on("end", onlegacyfinish), stream.on("close", onlegacyfinish)), !willEmitClose && typeof stream.aborted == "boolean" && stream.on("aborted", onclose), stream.on("end", onend), stream.on("finish", onfinish), options.error !== !1 && stream.on("error", onerror), stream.on("close", onclose), closed ? process.nextTick(onclose) : wState != null && wState.errorEmitted || rState != null && rState.errorEmitted ? willEmitClose || process.nextTick(onclosed) : (!readable && (!willEmitClose || isReadable(stream)) && (writableFinished || isWritable(stream) === !1) || !writable && (!willEmitClose || isWritable(stream)) && (readableFinished || isReadable(stream) === !1) || rState && stream.req && stream.aborted) && process.nextTick(onclosed);
      let cleanup = () => {
        callback = nop, stream.removeListener("aborted", onclose), stream.removeListener("complete", onfinish), stream.removeListener("abort", onclose), stream.removeListener("request", onrequest), stream.req && stream.req.removeListener("finish", onfinish), stream.removeListener("end", onlegacyfinish), stream.removeListener("close", onlegacyfinish), stream.removeListener("finish", onfinish), stream.removeListener("end", onend), stream.removeListener("error", onerror), stream.removeListener("close", onclose);
      };
      if (options.signal && !closed) {
        let abort = () => {
          let endCallback = callback;
          cleanup(), endCallback.call(
            stream,
            new AbortError(void 0, {
              cause: options.signal.reason
            })
          );
        };
        if (options.signal.aborted)
          process.nextTick(abort);
        else {
          addAbortListener = addAbortListener || require_util().addAbortListener;
          let disposable = addAbortListener(options.signal, abort), originalCallback = callback;
          callback = once((...args) => {
            disposable[SymbolDispose](), originalCallback.apply(stream, args);
          });
        }
      }
      return cleanup;
    }
    function eosWeb(stream, options, callback) {
      let isAborted = !1, abort = nop;
      if (options.signal)
        if (abort = () => {
          isAborted = !0, callback.call(
            stream,
            new AbortError(void 0, {
              cause: options.signal.reason
            })
          );
        }, options.signal.aborted)
          process.nextTick(abort);
        else {
          addAbortListener = addAbortListener || require_util().addAbortListener;
          let disposable = addAbortListener(options.signal, abort), originalCallback = callback;
          callback = once((...args) => {
            disposable[SymbolDispose](), originalCallback.apply(stream, args);
          });
        }
      let resolverFn = (...args) => {
        isAborted || process.nextTick(() => callback.apply(stream, args));
      };
      return PromisePrototypeThen(stream[kIsClosedPromise].promise, resolverFn, resolverFn), nop;
    }
    function finished(stream, opts) {
      var _opts;
      let autoCleanup = !1;
      return opts === null && (opts = kEmptyObject), (_opts = opts) !== null && _opts !== void 0 && _opts.cleanup && (validateBoolean(opts.cleanup, "cleanup"), autoCleanup = opts.cleanup), new Promise2((resolve2, reject) => {
        let cleanup = eos(stream, opts, (err) => {
          autoCleanup && cleanup(), err ? reject(err) : resolve2();
        });
      });
    }
    module.exports = eos;
    module.exports.finished = finished;
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/destroy.js
var require_destroy = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/destroy.js"(exports, module) {
    "use strict";
    var process = require_process(), {
      aggregateTwoErrors,
      codes: { ERR_MULTIPLE_CALLBACK },
      AbortError
    } = require_errors(), { Symbol: Symbol2 } = require_primordials(), { kIsDestroyed, isDestroyed, isFinished, isServerRequest } = require_utils(), kDestroy = Symbol2("kDestroy"), kConstruct = Symbol2("kConstruct");
    function checkError(err, w, r) {
      err && (err.stack, w && !w.errored && (w.errored = err), r && !r.errored && (r.errored = err));
    }
    function destroy(err, cb) {
      let r = this._readableState, w = this._writableState, s2 = w || r;
      return w != null && w.destroyed || r != null && r.destroyed ? (typeof cb == "function" && cb(), this) : (checkError(err, w, r), w && (w.destroyed = !0), r && (r.destroyed = !0), s2.constructed ? _destroy(this, err, cb) : this.once(kDestroy, function(er) {
        _destroy(this, aggregateTwoErrors(er, err), cb);
      }), this);
    }
    function _destroy(self2, err, cb) {
      let called = !1;
      function onDestroy(err2) {
        if (called)
          return;
        called = !0;
        let r = self2._readableState, w = self2._writableState;
        checkError(err2, w, r), w && (w.closed = !0), r && (r.closed = !0), typeof cb == "function" && cb(err2), err2 ? process.nextTick(emitErrorCloseNT, self2, err2) : process.nextTick(emitCloseNT, self2);
      }
      try {
        self2._destroy(err || null, onDestroy);
      } catch (err2) {
        onDestroy(err2);
      }
    }
    function emitErrorCloseNT(self2, err) {
      emitErrorNT(self2, err), emitCloseNT(self2);
    }
    function emitCloseNT(self2) {
      let r = self2._readableState, w = self2._writableState;
      w && (w.closeEmitted = !0), r && (r.closeEmitted = !0), (w != null && w.emitClose || r != null && r.emitClose) && self2.emit("close");
    }
    function emitErrorNT(self2, err) {
      let r = self2._readableState, w = self2._writableState;
      w != null && w.errorEmitted || r != null && r.errorEmitted || (w && (w.errorEmitted = !0), r && (r.errorEmitted = !0), self2.emit("error", err));
    }
    function undestroy() {
      let r = this._readableState, w = this._writableState;
      r && (r.constructed = !0, r.closed = !1, r.closeEmitted = !1, r.destroyed = !1, r.errored = null, r.errorEmitted = !1, r.reading = !1, r.ended = r.readable === !1, r.endEmitted = r.readable === !1), w && (w.constructed = !0, w.destroyed = !1, w.closed = !1, w.closeEmitted = !1, w.errored = null, w.errorEmitted = !1, w.finalCalled = !1, w.prefinished = !1, w.ended = w.writable === !1, w.ending = w.writable === !1, w.finished = w.writable === !1);
    }
    function errorOrDestroy(stream, err, sync) {
      let r = stream._readableState, w = stream._writableState;
      if (w != null && w.destroyed || r != null && r.destroyed)
        return this;
      r != null && r.autoDestroy || w != null && w.autoDestroy ? stream.destroy(err) : err && (err.stack, w && !w.errored && (w.errored = err), r && !r.errored && (r.errored = err), sync ? process.nextTick(emitErrorNT, stream, err) : emitErrorNT(stream, err));
    }
    function construct(stream, cb) {
      if (typeof stream._construct != "function")
        return;
      let r = stream._readableState, w = stream._writableState;
      r && (r.constructed = !1), w && (w.constructed = !1), stream.once(kConstruct, cb), !(stream.listenerCount(kConstruct) > 1) && process.nextTick(constructNT, stream);
    }
    function constructNT(stream) {
      let called = !1;
      function onConstruct(err) {
        if (called) {
          errorOrDestroy(stream, err ?? new ERR_MULTIPLE_CALLBACK());
          return;
        }
        called = !0;
        let r = stream._readableState, w = stream._writableState, s2 = w || r;
        r && (r.constructed = !0), w && (w.constructed = !0), s2.destroyed ? stream.emit(kDestroy, err) : err ? errorOrDestroy(stream, err, !0) : process.nextTick(emitConstructNT, stream);
      }
      try {
        stream._construct((err) => {
          process.nextTick(onConstruct, err);
        });
      } catch (err) {
        process.nextTick(onConstruct, err);
      }
    }
    function emitConstructNT(stream) {
      stream.emit(kConstruct);
    }
    function isRequest(stream) {
      return stream?.setHeader && typeof stream.abort == "function";
    }
    function emitCloseLegacy(stream) {
      stream.emit("close");
    }
    function emitErrorCloseLegacy(stream, err) {
      stream.emit("error", err), process.nextTick(emitCloseLegacy, stream);
    }
    function destroyer(stream, err) {
      !stream || isDestroyed(stream) || (!err && !isFinished(stream) && (err = new AbortError()), isServerRequest(stream) ? (stream.socket = null, stream.destroy(err)) : isRequest(stream) ? stream.abort() : isRequest(stream.req) ? stream.req.abort() : typeof stream.destroy == "function" ? stream.destroy(err) : typeof stream.close == "function" ? stream.close() : err ? process.nextTick(emitErrorCloseLegacy, stream, err) : process.nextTick(emitCloseLegacy, stream), stream.destroyed || (stream[kIsDestroyed] = !0));
    }
    module.exports = {
      construct,
      destroyer,
      destroy,
      undestroy,
      errorOrDestroy
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/legacy.js
var require_legacy = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/legacy.js"(exports, module) {
    "use strict";
    var { ArrayIsArray, ObjectSetPrototypeOf } = require_primordials(), { EventEmitter: EE } = require_events();
    function Stream(opts) {
      EE.call(this, opts);
    }
    ObjectSetPrototypeOf(Stream.prototype, EE.prototype);
    ObjectSetPrototypeOf(Stream, EE);
    Stream.prototype.pipe = function(dest, options) {
      let source = this;
      function ondata(chunk) {
        dest.writable && dest.write(chunk) === !1 && source.pause && source.pause();
      }
      source.on("data", ondata);
      function ondrain() {
        source.readable && source.resume && source.resume();
      }
      dest.on("drain", ondrain), !dest._isStdio && (!options || options.end !== !1) && (source.on("end", onend), source.on("close", onclose));
      let didOnEnd = !1;
      function onend() {
        didOnEnd || (didOnEnd = !0, dest.end());
      }
      function onclose() {
        didOnEnd || (didOnEnd = !0, typeof dest.destroy == "function" && dest.destroy());
      }
      function onerror(er) {
        cleanup(), EE.listenerCount(this, "error") === 0 && this.emit("error", er);
      }
      prependListener(source, "error", onerror), prependListener(dest, "error", onerror);
      function cleanup() {
        source.removeListener("data", ondata), dest.removeListener("drain", ondrain), source.removeListener("end", onend), source.removeListener("close", onclose), source.removeListener("error", onerror), dest.removeListener("error", onerror), source.removeListener("end", cleanup), source.removeListener("close", cleanup), dest.removeListener("close", cleanup);
      }
      return source.on("end", cleanup), source.on("close", cleanup), dest.on("close", cleanup), dest.emit("pipe", source), dest;
    };
    function prependListener(emitter, event, fn) {
      if (typeof emitter.prependListener == "function") return emitter.prependListener(event, fn);
      !emitter._events || !emitter._events[event] ? emitter.on(event, fn) : ArrayIsArray(emitter._events[event]) ? emitter._events[event].unshift(fn) : emitter._events[event] = [fn, emitter._events[event]];
    }
    module.exports = {
      Stream,
      prependListener
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/add-abort-signal.js
var require_add_abort_signal = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/add-abort-signal.js"(exports, module) {
    "use strict";
    var { SymbolDispose } = require_primordials(), { AbortError, codes } = require_errors(), { isNodeStream, isWebStream, kControllerErrorFunction } = require_utils(), eos = require_end_of_stream(), { ERR_INVALID_ARG_TYPE } = codes, addAbortListener, validateAbortSignal = (signal, name) => {
      if (typeof signal != "object" || !("aborted" in signal))
        throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
    };
    module.exports.addAbortSignal = function(signal, stream) {
      if (validateAbortSignal(signal, "signal"), !isNodeStream(stream) && !isWebStream(stream))
        throw new ERR_INVALID_ARG_TYPE("stream", ["ReadableStream", "WritableStream", "Stream"], stream);
      return module.exports.addAbortSignalNoValidate(signal, stream);
    };
    module.exports.addAbortSignalNoValidate = function(signal, stream) {
      if (typeof signal != "object" || !("aborted" in signal))
        return stream;
      let onAbort = isNodeStream(stream) ? () => {
        stream.destroy(
          new AbortError(void 0, {
            cause: signal.reason
          })
        );
      } : () => {
        stream[kControllerErrorFunction](
          new AbortError(void 0, {
            cause: signal.reason
          })
        );
      };
      if (signal.aborted)
        onAbort();
      else {
        addAbortListener = addAbortListener || require_util().addAbortListener;
        let disposable = addAbortListener(signal, onAbort);
        eos(stream, disposable[SymbolDispose]);
      }
      return stream;
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/buffer_list.js
var require_buffer_list = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/buffer_list.js"(exports, module) {
    "use strict";
    var { StringPrototypeSlice, SymbolIterator, TypedArrayPrototypeSet, Uint8Array: Uint8Array2 } = require_primordials(), { Buffer: Buffer6 } = require_buffer(), { inspect: inspect2 } = require_util();
    module.exports = class {
      constructor() {
        this.head = null, this.tail = null, this.length = 0;
      }
      push(v) {
        let entry = {
          data: v,
          next: null
        };
        this.length > 0 ? this.tail.next = entry : this.head = entry, this.tail = entry, ++this.length;
      }
      unshift(v) {
        let entry = {
          data: v,
          next: this.head
        };
        this.length === 0 && (this.tail = entry), this.head = entry, ++this.length;
      }
      shift() {
        if (this.length === 0) return;
        let ret = this.head.data;
        return this.length === 1 ? this.head = this.tail = null : this.head = this.head.next, --this.length, ret;
      }
      clear() {
        this.head = this.tail = null, this.length = 0;
      }
      join(s2) {
        if (this.length === 0) return "";
        let p = this.head, ret = "" + p.data;
        for (; (p = p.next) !== null; ) ret += s2 + p.data;
        return ret;
      }
      concat(n) {
        if (this.length === 0) return Buffer6.alloc(0);
        let ret = Buffer6.allocUnsafe(n >>> 0), p = this.head, i = 0;
        for (; p; )
          TypedArrayPrototypeSet(ret, p.data, i), i += p.data.length, p = p.next;
        return ret;
      }
      // Consumes a specified amount of bytes or characters from the buffered data.
      consume(n, hasStrings) {
        let data = this.head.data;
        if (n < data.length) {
          let slice = data.slice(0, n);
          return this.head.data = data.slice(n), slice;
        }
        return n === data.length ? this.shift() : hasStrings ? this._getString(n) : this._getBuffer(n);
      }
      first() {
        return this.head.data;
      }
      *[SymbolIterator]() {
        for (let p = this.head; p; p = p.next)
          yield p.data;
      }
      // Consumes a specified amount of characters from the buffered data.
      _getString(n) {
        let ret = "", p = this.head, c = 0;
        do {
          let str = p.data;
          if (n > str.length)
            ret += str, n -= str.length;
          else {
            n === str.length ? (ret += str, ++c, p.next ? this.head = p.next : this.head = this.tail = null) : (ret += StringPrototypeSlice(str, 0, n), this.head = p, p.data = StringPrototypeSlice(str, n));
            break;
          }
          ++c;
        } while ((p = p.next) !== null);
        return this.length -= c, ret;
      }
      // Consumes a specified amount of bytes from the buffered data.
      _getBuffer(n) {
        let ret = Buffer6.allocUnsafe(n), retLen = n, p = this.head, c = 0;
        do {
          let buf = p.data;
          if (n > buf.length)
            TypedArrayPrototypeSet(ret, buf, retLen - n), n -= buf.length;
          else {
            n === buf.length ? (TypedArrayPrototypeSet(ret, buf, retLen - n), ++c, p.next ? this.head = p.next : this.head = this.tail = null) : (TypedArrayPrototypeSet(ret, new Uint8Array2(buf.buffer, buf.byteOffset, n), retLen - n), this.head = p, p.data = buf.slice(n));
            break;
          }
          ++c;
        } while ((p = p.next) !== null);
        return this.length -= c, ret;
      }
      // Make sure the linked list only shows the minimal necessary information.
      [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")](_, options) {
        return inspect2(this, {
          ...options,
          // Only inspect one level.
          depth: 0,
          // It should not recurse.
          customInspect: !1
        });
      }
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/state.js
var require_state = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/state.js"(exports, module) {
    "use strict";
    var { MathFloor, NumberIsInteger } = require_primordials(), { validateInteger } = require_validators(), { ERR_INVALID_ARG_VALUE } = require_errors().codes, defaultHighWaterMarkBytes = 16 * 1024, defaultHighWaterMarkObjectMode = 16;
    function highWaterMarkFrom(options, isDuplex, duplexKey) {
      return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
    }
    function getDefaultHighWaterMark(objectMode) {
      return objectMode ? defaultHighWaterMarkObjectMode : defaultHighWaterMarkBytes;
    }
    function setDefaultHighWaterMark(objectMode, value) {
      validateInteger(value, "value", 0), objectMode ? defaultHighWaterMarkObjectMode = value : defaultHighWaterMarkBytes = value;
    }
    function getHighWaterMark(state, options, duplexKey, isDuplex) {
      let hwm = highWaterMarkFrom(options, isDuplex, duplexKey);
      if (hwm != null) {
        if (!NumberIsInteger(hwm) || hwm < 0) {
          let name = isDuplex ? `options.${duplexKey}` : "options.highWaterMark";
          throw new ERR_INVALID_ARG_VALUE(name, hwm);
        }
        return MathFloor(hwm);
      }
      return getDefaultHighWaterMark(state.objectMode);
    }
    module.exports = {
      getHighWaterMark,
      getDefaultHighWaterMark,
      setDefaultHighWaterMark
    };
  }
});

// node_modules/.pnpm/safe-buffer@5.2.1/node_modules/safe-buffer/index.js
var require_safe_buffer = __commonJS({
  "node_modules/.pnpm/safe-buffer@5.2.1/node_modules/safe-buffer/index.js"(exports, module) {
    var buffer = require_buffer(), Buffer6 = buffer.Buffer;
    function copyProps(src, dst) {
      for (var key in src)
        dst[key] = src[key];
    }
    Buffer6.from && Buffer6.alloc && Buffer6.allocUnsafe && Buffer6.allocUnsafeSlow ? module.exports = buffer : (copyProps(buffer, exports), exports.Buffer = SafeBuffer);
    function SafeBuffer(arg, encodingOrOffset, length) {
      return Buffer6(arg, encodingOrOffset, length);
    }
    SafeBuffer.prototype = Object.create(Buffer6.prototype);
    copyProps(Buffer6, SafeBuffer);
    SafeBuffer.from = function(arg, encodingOrOffset, length) {
      if (typeof arg == "number")
        throw new TypeError("Argument must not be a number");
      return Buffer6(arg, encodingOrOffset, length);
    };
    SafeBuffer.alloc = function(size, fill, encoding) {
      if (typeof size != "number")
        throw new TypeError("Argument must be a number");
      var buf = Buffer6(size);
      return fill !== void 0 ? typeof encoding == "string" ? buf.fill(fill, encoding) : buf.fill(fill) : buf.fill(0), buf;
    };
    SafeBuffer.allocUnsafe = function(size) {
      if (typeof size != "number")
        throw new TypeError("Argument must be a number");
      return Buffer6(size);
    };
    SafeBuffer.allocUnsafeSlow = function(size) {
      if (typeof size != "number")
        throw new TypeError("Argument must be a number");
      return buffer.SlowBuffer(size);
    };
  }
});

// node_modules/.pnpm/string_decoder@1.3.0/node_modules/string_decoder/lib/string_decoder.js
var require_string_decoder = __commonJS({
  "node_modules/.pnpm/string_decoder@1.3.0/node_modules/string_decoder/lib/string_decoder.js"(exports) {
    "use strict";
    var Buffer6 = require_safe_buffer().Buffer, isEncoding = Buffer6.isEncoding || function(encoding) {
      switch (encoding = "" + encoding, encoding && encoding.toLowerCase()) {
        case "hex":
        case "utf8":
        case "utf-8":
        case "ascii":
        case "binary":
        case "base64":
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
        case "raw":
          return !0;
        default:
          return !1;
      }
    };
    function _normalizeEncoding(enc2) {
      if (!enc2) return "utf8";
      for (var retried; ; )
        switch (enc2) {
          case "utf8":
          case "utf-8":
            return "utf8";
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return "utf16le";
          case "latin1":
          case "binary":
            return "latin1";
          case "base64":
          case "ascii":
          case "hex":
            return enc2;
          default:
            if (retried) return;
            enc2 = ("" + enc2).toLowerCase(), retried = !0;
        }
    }
    function normalizeEncoding(enc2) {
      var nenc = _normalizeEncoding(enc2);
      if (typeof nenc != "string" && (Buffer6.isEncoding === isEncoding || !isEncoding(enc2))) throw new Error("Unknown encoding: " + enc2);
      return nenc || enc2;
    }
    exports.StringDecoder = StringDecoder2;
    function StringDecoder2(encoding) {
      this.encoding = normalizeEncoding(encoding);
      var nb;
      switch (this.encoding) {
        case "utf16le":
          this.text = utf16Text, this.end = utf16End, nb = 4;
          break;
        case "utf8":
          this.fillLast = utf8FillLast, nb = 4;
          break;
        case "base64":
          this.text = base64Text, this.end = base64End, nb = 3;
          break;
        default:
          this.write = simpleWrite, this.end = simpleEnd;
          return;
      }
      this.lastNeed = 0, this.lastTotal = 0, this.lastChar = Buffer6.allocUnsafe(nb);
    }
    StringDecoder2.prototype.write = function(buf) {
      if (buf.length === 0) return "";
      var r, i;
      if (this.lastNeed) {
        if (r = this.fillLast(buf), r === void 0) return "";
        i = this.lastNeed, this.lastNeed = 0;
      } else
        i = 0;
      return i < buf.length ? r ? r + this.text(buf, i) : this.text(buf, i) : r || "";
    };
    StringDecoder2.prototype.end = utf8End;
    StringDecoder2.prototype.text = utf8Text;
    StringDecoder2.prototype.fillLast = function(buf) {
      if (this.lastNeed <= buf.length)
        return buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, this.lastNeed), this.lastChar.toString(this.encoding, 0, this.lastTotal);
      buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, buf.length), this.lastNeed -= buf.length;
    };
    function utf8CheckByte(byte) {
      return byte <= 127 ? 0 : byte >> 5 === 6 ? 2 : byte >> 4 === 14 ? 3 : byte >> 3 === 30 ? 4 : byte >> 6 === 2 ? -1 : -2;
    }
    function utf8CheckIncomplete(self2, buf, i) {
      var j = buf.length - 1;
      if (j < i) return 0;
      var nb = utf8CheckByte(buf[j]);
      return nb >= 0 ? (nb > 0 && (self2.lastNeed = nb - 1), nb) : --j < i || nb === -2 ? 0 : (nb = utf8CheckByte(buf[j]), nb >= 0 ? (nb > 0 && (self2.lastNeed = nb - 2), nb) : --j < i || nb === -2 ? 0 : (nb = utf8CheckByte(buf[j]), nb >= 0 ? (nb > 0 && (nb === 2 ? nb = 0 : self2.lastNeed = nb - 3), nb) : 0));
    }
    function utf8CheckExtraBytes(self2, buf, p) {
      if ((buf[0] & 192) !== 128)
        return self2.lastNeed = 0, "\uFFFD";
      if (self2.lastNeed > 1 && buf.length > 1) {
        if ((buf[1] & 192) !== 128)
          return self2.lastNeed = 1, "\uFFFD";
        if (self2.lastNeed > 2 && buf.length > 2 && (buf[2] & 192) !== 128)
          return self2.lastNeed = 2, "\uFFFD";
      }
    }
    function utf8FillLast(buf) {
      var p = this.lastTotal - this.lastNeed, r = utf8CheckExtraBytes(this, buf, p);
      if (r !== void 0) return r;
      if (this.lastNeed <= buf.length)
        return buf.copy(this.lastChar, p, 0, this.lastNeed), this.lastChar.toString(this.encoding, 0, this.lastTotal);
      buf.copy(this.lastChar, p, 0, buf.length), this.lastNeed -= buf.length;
    }
    function utf8Text(buf, i) {
      var total = utf8CheckIncomplete(this, buf, i);
      if (!this.lastNeed) return buf.toString("utf8", i);
      this.lastTotal = total;
      var end = buf.length - (total - this.lastNeed);
      return buf.copy(this.lastChar, 0, end), buf.toString("utf8", i, end);
    }
    function utf8End(buf) {
      var r = buf && buf.length ? this.write(buf) : "";
      return this.lastNeed ? r + "\uFFFD" : r;
    }
    function utf16Text(buf, i) {
      if ((buf.length - i) % 2 === 0) {
        var r = buf.toString("utf16le", i);
        if (r) {
          var c = r.charCodeAt(r.length - 1);
          if (c >= 55296 && c <= 56319)
            return this.lastNeed = 2, this.lastTotal = 4, this.lastChar[0] = buf[buf.length - 2], this.lastChar[1] = buf[buf.length - 1], r.slice(0, -1);
        }
        return r;
      }
      return this.lastNeed = 1, this.lastTotal = 2, this.lastChar[0] = buf[buf.length - 1], buf.toString("utf16le", i, buf.length - 1);
    }
    function utf16End(buf) {
      var r = buf && buf.length ? this.write(buf) : "";
      if (this.lastNeed) {
        var end = this.lastTotal - this.lastNeed;
        return r + this.lastChar.toString("utf16le", 0, end);
      }
      return r;
    }
    function base64Text(buf, i) {
      var n = (buf.length - i) % 3;
      return n === 0 ? buf.toString("base64", i) : (this.lastNeed = 3 - n, this.lastTotal = 3, n === 1 ? this.lastChar[0] = buf[buf.length - 1] : (this.lastChar[0] = buf[buf.length - 2], this.lastChar[1] = buf[buf.length - 1]), buf.toString("base64", i, buf.length - n));
    }
    function base64End(buf) {
      var r = buf && buf.length ? this.write(buf) : "";
      return this.lastNeed ? r + this.lastChar.toString("base64", 0, 3 - this.lastNeed) : r;
    }
    function simpleWrite(buf) {
      return buf.toString(this.encoding);
    }
    function simpleEnd(buf) {
      return buf && buf.length ? this.write(buf) : "";
    }
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/from.js
var require_from = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/from.js"(exports, module) {
    "use strict";
    var process = require_process(), { PromisePrototypeThen, SymbolAsyncIterator, SymbolIterator } = require_primordials(), { Buffer: Buffer6 } = require_buffer(), { ERR_INVALID_ARG_TYPE, ERR_STREAM_NULL_VALUES } = require_errors().codes;
    function from(Readable3, iterable, opts) {
      let iterator;
      if (typeof iterable == "string" || iterable instanceof Buffer6)
        return new Readable3({
          objectMode: !0,
          ...opts,
          read() {
            this.push(iterable), this.push(null);
          }
        });
      let isAsync;
      if (iterable && iterable[SymbolAsyncIterator])
        isAsync = !0, iterator = iterable[SymbolAsyncIterator]();
      else if (iterable && iterable[SymbolIterator])
        isAsync = !1, iterator = iterable[SymbolIterator]();
      else
        throw new ERR_INVALID_ARG_TYPE("iterable", ["Iterable"], iterable);
      let readable = new Readable3({
        objectMode: !0,
        highWaterMark: 1,
        // TODO(ronag): What options should be allowed?
        ...opts
      }), reading = !1;
      readable._read = function() {
        reading || (reading = !0, next());
      }, readable._destroy = function(error, cb) {
        PromisePrototypeThen(
          close(error),
          () => process.nextTick(cb, error),
          // nextTick is here in case cb throws
          (e) => process.nextTick(cb, e || error)
        );
      };
      async function close(error) {
        let hadError = error != null, hasThrow = typeof iterator.throw == "function";
        if (hadError && hasThrow) {
          let { value, done } = await iterator.throw(error);
          if (await value, done)
            return;
        }
        if (typeof iterator.return == "function") {
          let { value } = await iterator.return();
          await value;
        }
      }
      async function next() {
        for (; ; ) {
          try {
            let { value, done } = isAsync ? await iterator.next() : iterator.next();
            if (done)
              readable.push(null);
            else {
              let res = value && typeof value.then == "function" ? await value : value;
              if (res === null)
                throw reading = !1, new ERR_STREAM_NULL_VALUES();
              if (readable.push(res))
                continue;
              reading = !1;
            }
          } catch (err) {
            readable.destroy(err);
          }
          break;
        }
      }
      return readable;
    }
    module.exports = from;
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/readable.js
var require_readable = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/readable.js"(exports, module) {
    "use strict";
    var process = require_process(), {
      ArrayPrototypeIndexOf,
      NumberIsInteger,
      NumberIsNaN,
      NumberParseInt,
      ObjectDefineProperties,
      ObjectKeys,
      ObjectSetPrototypeOf,
      Promise: Promise2,
      SafeSet,
      SymbolAsyncDispose,
      SymbolAsyncIterator,
      Symbol: Symbol2
    } = require_primordials();
    module.exports = Readable3;
    Readable3.ReadableState = ReadableState;
    var { EventEmitter: EE } = require_events(), { Stream, prependListener } = require_legacy(), { Buffer: Buffer6 } = require_buffer(), { addAbortSignal } = require_add_abort_signal(), eos = require_end_of_stream(), debug = require_util().debuglog("stream", (fn) => {
      debug = fn;
    }), BufferList = require_buffer_list(), destroyImpl = require_destroy(), { getHighWaterMark, getDefaultHighWaterMark } = require_state(), {
      aggregateTwoErrors,
      codes: {
        ERR_INVALID_ARG_TYPE,
        ERR_METHOD_NOT_IMPLEMENTED,
        ERR_OUT_OF_RANGE,
        ERR_STREAM_PUSH_AFTER_EOF,
        ERR_STREAM_UNSHIFT_AFTER_END_EVENT
      },
      AbortError
    } = require_errors(), { validateObject } = require_validators(), kPaused = Symbol2("kPaused"), { StringDecoder: StringDecoder2 } = require_string_decoder(), from = require_from();
    ObjectSetPrototypeOf(Readable3.prototype, Stream.prototype);
    ObjectSetPrototypeOf(Readable3, Stream);
    var nop = () => {
    }, { errorOrDestroy } = destroyImpl, kObjectMode = 1, kEnded = 2, kEndEmitted = 4, kReading = 8, kConstructed = 16, kSync = 32, kNeedReadable = 64, kEmittedReadable = 128, kReadableListening = 256, kResumeScheduled = 512, kErrorEmitted = 1024, kEmitClose = 2048, kAutoDestroy = 4096, kDestroyed = 8192, kClosed = 16384, kCloseEmitted = 32768, kMultiAwaitDrain = 65536, kReadingMore = 1 << 17, kDataEmitted = 1 << 18;
    function makeBitMapDescriptor(bit) {
      return {
        enumerable: !1,
        get() {
          return (this.state & bit) !== 0;
        },
        set(value) {
          value ? this.state |= bit : this.state &= ~bit;
        }
      };
    }
    ObjectDefineProperties(ReadableState.prototype, {
      objectMode: makeBitMapDescriptor(kObjectMode),
      ended: makeBitMapDescriptor(kEnded),
      endEmitted: makeBitMapDescriptor(kEndEmitted),
      reading: makeBitMapDescriptor(kReading),
      // Stream is still being constructed and cannot be
      // destroyed until construction finished or failed.
      // Async construction is opt in, therefore we start as
      // constructed.
      constructed: makeBitMapDescriptor(kConstructed),
      // A flag to be able to tell if the event 'readable'/'data' is emitted
      // immediately, or on a later tick.  We set this to true at first, because
      // any actions that shouldn't happen until "later" should generally also
      // not happen before the first read call.
      sync: makeBitMapDescriptor(kSync),
      // Whenever we return null, then we set a flag to say
      // that we're awaiting a 'readable' event emission.
      needReadable: makeBitMapDescriptor(kNeedReadable),
      emittedReadable: makeBitMapDescriptor(kEmittedReadable),
      readableListening: makeBitMapDescriptor(kReadableListening),
      resumeScheduled: makeBitMapDescriptor(kResumeScheduled),
      // True if the error was already emitted and should not be thrown again.
      errorEmitted: makeBitMapDescriptor(kErrorEmitted),
      emitClose: makeBitMapDescriptor(kEmitClose),
      autoDestroy: makeBitMapDescriptor(kAutoDestroy),
      // Has it been destroyed.
      destroyed: makeBitMapDescriptor(kDestroyed),
      // Indicates whether the stream has finished destroying.
      closed: makeBitMapDescriptor(kClosed),
      // True if close has been emitted or would have been emitted
      // depending on emitClose.
      closeEmitted: makeBitMapDescriptor(kCloseEmitted),
      multiAwaitDrain: makeBitMapDescriptor(kMultiAwaitDrain),
      // If true, a maybeReadMore has been scheduled.
      readingMore: makeBitMapDescriptor(kReadingMore),
      dataEmitted: makeBitMapDescriptor(kDataEmitted)
    });
    function ReadableState(options, stream, isDuplex) {
      typeof isDuplex != "boolean" && (isDuplex = stream instanceof require_duplex()), this.state = kEmitClose | kAutoDestroy | kConstructed | kSync, options && options.objectMode && (this.state |= kObjectMode), isDuplex && options && options.readableObjectMode && (this.state |= kObjectMode), this.highWaterMark = options ? getHighWaterMark(this, options, "readableHighWaterMark", isDuplex) : getDefaultHighWaterMark(!1), this.buffer = new BufferList(), this.length = 0, this.pipes = [], this.flowing = null, this[kPaused] = null, options && options.emitClose === !1 && (this.state &= ~kEmitClose), options && options.autoDestroy === !1 && (this.state &= ~kAutoDestroy), this.errored = null, this.defaultEncoding = options && options.defaultEncoding || "utf8", this.awaitDrainWriters = null, this.decoder = null, this.encoding = null, options && options.encoding && (this.decoder = new StringDecoder2(options.encoding), this.encoding = options.encoding);
    }
    function Readable3(options) {
      if (!(this instanceof Readable3)) return new Readable3(options);
      let isDuplex = this instanceof require_duplex();
      this._readableState = new ReadableState(options, this, isDuplex), options && (typeof options.read == "function" && (this._read = options.read), typeof options.destroy == "function" && (this._destroy = options.destroy), typeof options.construct == "function" && (this._construct = options.construct), options.signal && !isDuplex && addAbortSignal(options.signal, this)), Stream.call(this, options), destroyImpl.construct(this, () => {
        this._readableState.needReadable && maybeReadMore(this, this._readableState);
      });
    }
    Readable3.prototype.destroy = destroyImpl.destroy;
    Readable3.prototype._undestroy = destroyImpl.undestroy;
    Readable3.prototype._destroy = function(err, cb) {
      cb(err);
    };
    Readable3.prototype[EE.captureRejectionSymbol] = function(err) {
      this.destroy(err);
    };
    Readable3.prototype[SymbolAsyncDispose] = function() {
      let error;
      return this.destroyed || (error = this.readableEnded ? null : new AbortError(), this.destroy(error)), new Promise2((resolve2, reject) => eos(this, (err) => err && err !== error ? reject(err) : resolve2(null)));
    };
    Readable3.prototype.push = function(chunk, encoding) {
      return readableAddChunk(this, chunk, encoding, !1);
    };
    Readable3.prototype.unshift = function(chunk, encoding) {
      return readableAddChunk(this, chunk, encoding, !0);
    };
    function readableAddChunk(stream, chunk, encoding, addToFront) {
      debug("readableAddChunk", chunk);
      let state = stream._readableState, err;
      if ((state.state & kObjectMode) === 0 && (typeof chunk == "string" ? (encoding = encoding || state.defaultEncoding, state.encoding !== encoding && (addToFront && state.encoding ? chunk = Buffer6.from(chunk, encoding).toString(state.encoding) : (chunk = Buffer6.from(chunk, encoding), encoding = ""))) : chunk instanceof Buffer6 ? encoding = "" : Stream._isUint8Array(chunk) ? (chunk = Stream._uint8ArrayToBuffer(chunk), encoding = "") : chunk != null && (err = new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "Uint8Array"], chunk))), err)
        errorOrDestroy(stream, err);
      else if (chunk === null)
        state.state &= ~kReading, onEofChunk(stream, state);
      else if ((state.state & kObjectMode) !== 0 || chunk && chunk.length > 0)
        if (addToFront)
          if ((state.state & kEndEmitted) !== 0) errorOrDestroy(stream, new ERR_STREAM_UNSHIFT_AFTER_END_EVENT());
          else {
            if (state.destroyed || state.errored) return !1;
            addChunk(stream, state, chunk, !0);
          }
        else if (state.ended)
          errorOrDestroy(stream, new ERR_STREAM_PUSH_AFTER_EOF());
        else {
          if (state.destroyed || state.errored)
            return !1;
          state.state &= ~kReading, state.decoder && !encoding ? (chunk = state.decoder.write(chunk), state.objectMode || chunk.length !== 0 ? addChunk(stream, state, chunk, !1) : maybeReadMore(stream, state)) : addChunk(stream, state, chunk, !1);
        }
      else addToFront || (state.state &= ~kReading, maybeReadMore(stream, state));
      return !state.ended && (state.length < state.highWaterMark || state.length === 0);
    }
    function addChunk(stream, state, chunk, addToFront) {
      state.flowing && state.length === 0 && !state.sync && stream.listenerCount("data") > 0 ? ((state.state & kMultiAwaitDrain) !== 0 ? state.awaitDrainWriters.clear() : state.awaitDrainWriters = null, state.dataEmitted = !0, stream.emit("data", chunk)) : (state.length += state.objectMode ? 1 : chunk.length, addToFront ? state.buffer.unshift(chunk) : state.buffer.push(chunk), (state.state & kNeedReadable) !== 0 && emitReadable(stream)), maybeReadMore(stream, state);
    }
    Readable3.prototype.isPaused = function() {
      let state = this._readableState;
      return state[kPaused] === !0 || state.flowing === !1;
    };
    Readable3.prototype.setEncoding = function(enc2) {
      let decoder = new StringDecoder2(enc2);
      this._readableState.decoder = decoder, this._readableState.encoding = this._readableState.decoder.encoding;
      let buffer = this._readableState.buffer, content = "";
      for (let data of buffer)
        content += decoder.write(data);
      return buffer.clear(), content !== "" && buffer.push(content), this._readableState.length = content.length, this;
    };
    var MAX_HWM = 1073741824;
    function computeNewHighWaterMark(n) {
      if (n > MAX_HWM)
        throw new ERR_OUT_OF_RANGE("size", "<= 1GiB", n);
      return n--, n |= n >>> 1, n |= n >>> 2, n |= n >>> 4, n |= n >>> 8, n |= n >>> 16, n++, n;
    }
    function howMuchToRead(n, state) {
      return n <= 0 || state.length === 0 && state.ended ? 0 : (state.state & kObjectMode) !== 0 ? 1 : NumberIsNaN(n) ? state.flowing && state.length ? state.buffer.first().length : state.length : n <= state.length ? n : state.ended ? state.length : 0;
    }
    Readable3.prototype.read = function(n) {
      debug("read", n), n === void 0 ? n = NaN : NumberIsInteger(n) || (n = NumberParseInt(n, 10));
      let state = this._readableState, nOrig = n;
      if (n > state.highWaterMark && (state.highWaterMark = computeNewHighWaterMark(n)), n !== 0 && (state.state &= ~kEmittedReadable), n === 0 && state.needReadable && ((state.highWaterMark !== 0 ? state.length >= state.highWaterMark : state.length > 0) || state.ended))
        return debug("read: emitReadable", state.length, state.ended), state.length === 0 && state.ended ? endReadable(this) : emitReadable(this), null;
      if (n = howMuchToRead(n, state), n === 0 && state.ended)
        return state.length === 0 && endReadable(this), null;
      let doRead = (state.state & kNeedReadable) !== 0;
      if (debug("need readable", doRead), (state.length === 0 || state.length - n < state.highWaterMark) && (doRead = !0, debug("length less than watermark", doRead)), state.ended || state.reading || state.destroyed || state.errored || !state.constructed)
        doRead = !1, debug("reading, ended or constructing", doRead);
      else if (doRead) {
        debug("do read"), state.state |= kReading | kSync, state.length === 0 && (state.state |= kNeedReadable);
        try {
          this._read(state.highWaterMark);
        } catch (err) {
          errorOrDestroy(this, err);
        }
        state.state &= ~kSync, state.reading || (n = howMuchToRead(nOrig, state));
      }
      let ret;
      return n > 0 ? ret = fromList(n, state) : ret = null, ret === null ? (state.needReadable = state.length <= state.highWaterMark, n = 0) : (state.length -= n, state.multiAwaitDrain ? state.awaitDrainWriters.clear() : state.awaitDrainWriters = null), state.length === 0 && (state.ended || (state.needReadable = !0), nOrig !== n && state.ended && endReadable(this)), ret !== null && !state.errorEmitted && !state.closeEmitted && (state.dataEmitted = !0, this.emit("data", ret)), ret;
    };
    function onEofChunk(stream, state) {
      if (debug("onEofChunk"), !state.ended) {
        if (state.decoder) {
          let chunk = state.decoder.end();
          chunk && chunk.length && (state.buffer.push(chunk), state.length += state.objectMode ? 1 : chunk.length);
        }
        state.ended = !0, state.sync ? emitReadable(stream) : (state.needReadable = !1, state.emittedReadable = !0, emitReadable_(stream));
      }
    }
    function emitReadable(stream) {
      let state = stream._readableState;
      debug("emitReadable", state.needReadable, state.emittedReadable), state.needReadable = !1, state.emittedReadable || (debug("emitReadable", state.flowing), state.emittedReadable = !0, process.nextTick(emitReadable_, stream));
    }
    function emitReadable_(stream) {
      let state = stream._readableState;
      debug("emitReadable_", state.destroyed, state.length, state.ended), !state.destroyed && !state.errored && (state.length || state.ended) && (stream.emit("readable"), state.emittedReadable = !1), state.needReadable = !state.flowing && !state.ended && state.length <= state.highWaterMark, flow(stream);
    }
    function maybeReadMore(stream, state) {
      !state.readingMore && state.constructed && (state.readingMore = !0, process.nextTick(maybeReadMore_, stream, state));
    }
    function maybeReadMore_(stream, state) {
      for (; !state.reading && !state.ended && (state.length < state.highWaterMark || state.flowing && state.length === 0); ) {
        let len = state.length;
        if (debug("maybeReadMore read 0"), stream.read(0), len === state.length)
          break;
      }
      state.readingMore = !1;
    }
    Readable3.prototype._read = function(n) {
      throw new ERR_METHOD_NOT_IMPLEMENTED("_read()");
    };
    Readable3.prototype.pipe = function(dest, pipeOpts) {
      let src = this, state = this._readableState;
      state.pipes.length === 1 && (state.multiAwaitDrain || (state.multiAwaitDrain = !0, state.awaitDrainWriters = new SafeSet(state.awaitDrainWriters ? [state.awaitDrainWriters] : []))), state.pipes.push(dest), debug("pipe count=%d opts=%j", state.pipes.length, pipeOpts);
      let endFn = (!pipeOpts || pipeOpts.end !== !1) && dest !== process.stdout && dest !== process.stderr ? onend : unpipe;
      state.endEmitted ? process.nextTick(endFn) : src.once("end", endFn), dest.on("unpipe", onunpipe);
      function onunpipe(readable, unpipeInfo) {
        debug("onunpipe"), readable === src && unpipeInfo && unpipeInfo.hasUnpiped === !1 && (unpipeInfo.hasUnpiped = !0, cleanup());
      }
      function onend() {
        debug("onend"), dest.end();
      }
      let ondrain, cleanedUp = !1;
      function cleanup() {
        debug("cleanup"), dest.removeListener("close", onclose), dest.removeListener("finish", onfinish), ondrain && dest.removeListener("drain", ondrain), dest.removeListener("error", onerror), dest.removeListener("unpipe", onunpipe), src.removeListener("end", onend), src.removeListener("end", unpipe), src.removeListener("data", ondata), cleanedUp = !0, ondrain && state.awaitDrainWriters && (!dest._writableState || dest._writableState.needDrain) && ondrain();
      }
      function pause() {
        cleanedUp || (state.pipes.length === 1 && state.pipes[0] === dest ? (debug("false write response, pause", 0), state.awaitDrainWriters = dest, state.multiAwaitDrain = !1) : state.pipes.length > 1 && state.pipes.includes(dest) && (debug("false write response, pause", state.awaitDrainWriters.size), state.awaitDrainWriters.add(dest)), src.pause()), ondrain || (ondrain = pipeOnDrain(src, dest), dest.on("drain", ondrain));
      }
      src.on("data", ondata);
      function ondata(chunk) {
        debug("ondata");
        let ret = dest.write(chunk);
        debug("dest.write", ret), ret === !1 && pause();
      }
      function onerror(er) {
        if (debug("onerror", er), unpipe(), dest.removeListener("error", onerror), dest.listenerCount("error") === 0) {
          let s2 = dest._writableState || dest._readableState;
          s2 && !s2.errorEmitted ? errorOrDestroy(dest, er) : dest.emit("error", er);
        }
      }
      prependListener(dest, "error", onerror);
      function onclose() {
        dest.removeListener("finish", onfinish), unpipe();
      }
      dest.once("close", onclose);
      function onfinish() {
        debug("onfinish"), dest.removeListener("close", onclose), unpipe();
      }
      dest.once("finish", onfinish);
      function unpipe() {
        debug("unpipe"), src.unpipe(dest);
      }
      return dest.emit("pipe", src), dest.writableNeedDrain === !0 ? pause() : state.flowing || (debug("pipe resume"), src.resume()), dest;
    };
    function pipeOnDrain(src, dest) {
      return function() {
        let state = src._readableState;
        state.awaitDrainWriters === dest ? (debug("pipeOnDrain", 1), state.awaitDrainWriters = null) : state.multiAwaitDrain && (debug("pipeOnDrain", state.awaitDrainWriters.size), state.awaitDrainWriters.delete(dest)), (!state.awaitDrainWriters || state.awaitDrainWriters.size === 0) && src.listenerCount("data") && src.resume();
      };
    }
    Readable3.prototype.unpipe = function(dest) {
      let state = this._readableState, unpipeInfo = {
        hasUnpiped: !1
      };
      if (state.pipes.length === 0) return this;
      if (!dest) {
        let dests = state.pipes;
        state.pipes = [], this.pause();
        for (let i = 0; i < dests.length; i++)
          dests[i].emit("unpipe", this, {
            hasUnpiped: !1
          });
        return this;
      }
      let index = ArrayPrototypeIndexOf(state.pipes, dest);
      return index === -1 ? this : (state.pipes.splice(index, 1), state.pipes.length === 0 && this.pause(), dest.emit("unpipe", this, unpipeInfo), this);
    };
    Readable3.prototype.on = function(ev, fn) {
      let res = Stream.prototype.on.call(this, ev, fn), state = this._readableState;
      return ev === "data" ? (state.readableListening = this.listenerCount("readable") > 0, state.flowing !== !1 && this.resume()) : ev === "readable" && !state.endEmitted && !state.readableListening && (state.readableListening = state.needReadable = !0, state.flowing = !1, state.emittedReadable = !1, debug("on readable", state.length, state.reading), state.length ? emitReadable(this) : state.reading || process.nextTick(nReadingNextTick, this)), res;
    };
    Readable3.prototype.addListener = Readable3.prototype.on;
    Readable3.prototype.removeListener = function(ev, fn) {
      let res = Stream.prototype.removeListener.call(this, ev, fn);
      return ev === "readable" && process.nextTick(updateReadableListening, this), res;
    };
    Readable3.prototype.off = Readable3.prototype.removeListener;
    Readable3.prototype.removeAllListeners = function(ev) {
      let res = Stream.prototype.removeAllListeners.apply(this, arguments);
      return (ev === "readable" || ev === void 0) && process.nextTick(updateReadableListening, this), res;
    };
    function updateReadableListening(self2) {
      let state = self2._readableState;
      state.readableListening = self2.listenerCount("readable") > 0, state.resumeScheduled && state[kPaused] === !1 ? state.flowing = !0 : self2.listenerCount("data") > 0 ? self2.resume() : state.readableListening || (state.flowing = null);
    }
    function nReadingNextTick(self2) {
      debug("readable nexttick read 0"), self2.read(0);
    }
    Readable3.prototype.resume = function() {
      let state = this._readableState;
      return state.flowing || (debug("resume"), state.flowing = !state.readableListening, resume(this, state)), state[kPaused] = !1, this;
    };
    function resume(stream, state) {
      state.resumeScheduled || (state.resumeScheduled = !0, process.nextTick(resume_, stream, state));
    }
    function resume_(stream, state) {
      debug("resume", state.reading), state.reading || stream.read(0), state.resumeScheduled = !1, stream.emit("resume"), flow(stream), state.flowing && !state.reading && stream.read(0);
    }
    Readable3.prototype.pause = function() {
      return debug("call pause flowing=%j", this._readableState.flowing), this._readableState.flowing !== !1 && (debug("pause"), this._readableState.flowing = !1, this.emit("pause")), this._readableState[kPaused] = !0, this;
    };
    function flow(stream) {
      let state = stream._readableState;
      for (debug("flow", state.flowing); state.flowing && stream.read() !== null; ) ;
    }
    Readable3.prototype.wrap = function(stream) {
      let paused = !1;
      stream.on("data", (chunk) => {
        !this.push(chunk) && stream.pause && (paused = !0, stream.pause());
      }), stream.on("end", () => {
        this.push(null);
      }), stream.on("error", (err) => {
        errorOrDestroy(this, err);
      }), stream.on("close", () => {
        this.destroy();
      }), stream.on("destroy", () => {
        this.destroy();
      }), this._read = () => {
        paused && stream.resume && (paused = !1, stream.resume());
      };
      let streamKeys = ObjectKeys(stream);
      for (let j = 1; j < streamKeys.length; j++) {
        let i = streamKeys[j];
        this[i] === void 0 && typeof stream[i] == "function" && (this[i] = stream[i].bind(stream));
      }
      return this;
    };
    Readable3.prototype[SymbolAsyncIterator] = function() {
      return streamToAsyncIterator(this);
    };
    Readable3.prototype.iterator = function(options) {
      return options !== void 0 && validateObject(options, "options"), streamToAsyncIterator(this, options);
    };
    function streamToAsyncIterator(stream, options) {
      typeof stream.read != "function" && (stream = Readable3.wrap(stream, {
        objectMode: !0
      }));
      let iter = createAsyncIterator(stream, options);
      return iter.stream = stream, iter;
    }
    async function* createAsyncIterator(stream, options) {
      let callback = nop;
      function next(resolve2) {
        this === stream ? (callback(), callback = nop) : callback = resolve2;
      }
      stream.on("readable", next);
      let error, cleanup = eos(
        stream,
        {
          writable: !1
        },
        (err) => {
          error = err ? aggregateTwoErrors(error, err) : null, callback(), callback = nop;
        }
      );
      try {
        for (; ; ) {
          let chunk = stream.destroyed ? null : stream.read();
          if (chunk !== null)
            yield chunk;
          else {
            if (error)
              throw error;
            if (error === null)
              return;
            await new Promise2(next);
          }
        }
      } catch (err) {
        throw error = aggregateTwoErrors(error, err), error;
      } finally {
        (error || options?.destroyOnReturn !== !1) && (error === void 0 || stream._readableState.autoDestroy) ? destroyImpl.destroyer(stream, null) : (stream.off("readable", next), cleanup());
      }
    }
    ObjectDefineProperties(Readable3.prototype, {
      readable: {
        __proto__: null,
        get() {
          let r = this._readableState;
          return !!r && r.readable !== !1 && !r.destroyed && !r.errorEmitted && !r.endEmitted;
        },
        set(val) {
          this._readableState && (this._readableState.readable = !!val);
        }
      },
      readableDidRead: {
        __proto__: null,
        enumerable: !1,
        get: function() {
          return this._readableState.dataEmitted;
        }
      },
      readableAborted: {
        __proto__: null,
        enumerable: !1,
        get: function() {
          return !!(this._readableState.readable !== !1 && (this._readableState.destroyed || this._readableState.errored) && !this._readableState.endEmitted);
        }
      },
      readableHighWaterMark: {
        __proto__: null,
        enumerable: !1,
        get: function() {
          return this._readableState.highWaterMark;
        }
      },
      readableBuffer: {
        __proto__: null,
        enumerable: !1,
        get: function() {
          return this._readableState && this._readableState.buffer;
        }
      },
      readableFlowing: {
        __proto__: null,
        enumerable: !1,
        get: function() {
          return this._readableState.flowing;
        },
        set: function(state) {
          this._readableState && (this._readableState.flowing = state);
        }
      },
      readableLength: {
        __proto__: null,
        enumerable: !1,
        get() {
          return this._readableState.length;
        }
      },
      readableObjectMode: {
        __proto__: null,
        enumerable: !1,
        get() {
          return this._readableState ? this._readableState.objectMode : !1;
        }
      },
      readableEncoding: {
        __proto__: null,
        enumerable: !1,
        get() {
          return this._readableState ? this._readableState.encoding : null;
        }
      },
      errored: {
        __proto__: null,
        enumerable: !1,
        get() {
          return this._readableState ? this._readableState.errored : null;
        }
      },
      closed: {
        __proto__: null,
        get() {
          return this._readableState ? this._readableState.closed : !1;
        }
      },
      destroyed: {
        __proto__: null,
        enumerable: !1,
        get() {
          return this._readableState ? this._readableState.destroyed : !1;
        },
        set(value) {
          this._readableState && (this._readableState.destroyed = value);
        }
      },
      readableEnded: {
        __proto__: null,
        enumerable: !1,
        get() {
          return this._readableState ? this._readableState.endEmitted : !1;
        }
      }
    });
    ObjectDefineProperties(ReadableState.prototype, {
      // Legacy getter for `pipesCount`.
      pipesCount: {
        __proto__: null,
        get() {
          return this.pipes.length;
        }
      },
      // Legacy property for `paused`.
      paused: {
        __proto__: null,
        get() {
          return this[kPaused] !== !1;
        },
        set(value) {
          this[kPaused] = !!value;
        }
      }
    });
    Readable3._fromList = fromList;
    function fromList(n, state) {
      if (state.length === 0) return null;
      let ret;
      return state.objectMode ? ret = state.buffer.shift() : !n || n >= state.length ? (state.decoder ? ret = state.buffer.join("") : state.buffer.length === 1 ? ret = state.buffer.first() : ret = state.buffer.concat(state.length), state.buffer.clear()) : ret = state.buffer.consume(n, state.decoder), ret;
    }
    function endReadable(stream) {
      let state = stream._readableState;
      debug("endReadable", state.endEmitted), state.endEmitted || (state.ended = !0, process.nextTick(endReadableNT, state, stream));
    }
    function endReadableNT(state, stream) {
      if (debug("endReadableNT", state.endEmitted, state.length), !state.errored && !state.closeEmitted && !state.endEmitted && state.length === 0) {
        if (state.endEmitted = !0, stream.emit("end"), stream.writable && stream.allowHalfOpen === !1)
          process.nextTick(endWritableNT, stream);
        else if (state.autoDestroy) {
          let wState = stream._writableState;
          (!wState || wState.autoDestroy && // We don't expect the writable to ever 'finish'
          // if writable is explicitly set to false.
          (wState.finished || wState.writable === !1)) && stream.destroy();
        }
      }
    }
    function endWritableNT(stream) {
      stream.writable && !stream.writableEnded && !stream.destroyed && stream.end();
    }
    Readable3.from = function(iterable, opts) {
      return from(Readable3, iterable, opts);
    };
    var webStreamsAdapters;
    function lazyWebStreams() {
      return webStreamsAdapters === void 0 && (webStreamsAdapters = {}), webStreamsAdapters;
    }
    Readable3.fromWeb = function(readableStream, options) {
      return lazyWebStreams().newStreamReadableFromReadableStream(readableStream, options);
    };
    Readable3.toWeb = function(streamReadable, options) {
      return lazyWebStreams().newReadableStreamFromStreamReadable(streamReadable, options);
    };
    Readable3.wrap = function(src, options) {
      var _ref, _src$readableObjectMo;
      return new Readable3({
        objectMode: (_ref = (_src$readableObjectMo = src.readableObjectMode) !== null && _src$readableObjectMo !== void 0 ? _src$readableObjectMo : src.objectMode) !== null && _ref !== void 0 ? _ref : !0,
        ...options,
        destroy(err, callback) {
          destroyImpl.destroyer(src, err), callback(err);
        }
      }).wrap(src);
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/writable.js
var require_writable = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/writable.js"(exports, module) {
    "use strict";
    var process = require_process(), {
      ArrayPrototypeSlice,
      Error: Error2,
      FunctionPrototypeSymbolHasInstance,
      ObjectDefineProperty,
      ObjectDefineProperties,
      ObjectSetPrototypeOf,
      StringPrototypeToLowerCase,
      Symbol: Symbol2,
      SymbolHasInstance
    } = require_primordials();
    module.exports = Writable3;
    Writable3.WritableState = WritableState;
    var { EventEmitter: EE } = require_events(), Stream = require_legacy().Stream, { Buffer: Buffer6 } = require_buffer(), destroyImpl = require_destroy(), { addAbortSignal } = require_add_abort_signal(), { getHighWaterMark, getDefaultHighWaterMark } = require_state(), {
      ERR_INVALID_ARG_TYPE,
      ERR_METHOD_NOT_IMPLEMENTED,
      ERR_MULTIPLE_CALLBACK,
      ERR_STREAM_CANNOT_PIPE,
      ERR_STREAM_DESTROYED,
      ERR_STREAM_ALREADY_FINISHED,
      ERR_STREAM_NULL_VALUES,
      ERR_STREAM_WRITE_AFTER_END,
      ERR_UNKNOWN_ENCODING
    } = require_errors().codes, { errorOrDestroy } = destroyImpl;
    ObjectSetPrototypeOf(Writable3.prototype, Stream.prototype);
    ObjectSetPrototypeOf(Writable3, Stream);
    function nop() {
    }
    var kOnFinished = Symbol2("kOnFinished");
    function WritableState(options, stream, isDuplex) {
      typeof isDuplex != "boolean" && (isDuplex = stream instanceof require_duplex()), this.objectMode = !!(options && options.objectMode), isDuplex && (this.objectMode = this.objectMode || !!(options && options.writableObjectMode)), this.highWaterMark = options ? getHighWaterMark(this, options, "writableHighWaterMark", isDuplex) : getDefaultHighWaterMark(!1), this.finalCalled = !1, this.needDrain = !1, this.ending = !1, this.ended = !1, this.finished = !1, this.destroyed = !1;
      let noDecode = !!(options && options.decodeStrings === !1);
      this.decodeStrings = !noDecode, this.defaultEncoding = options && options.defaultEncoding || "utf8", this.length = 0, this.writing = !1, this.corked = 0, this.sync = !0, this.bufferProcessing = !1, this.onwrite = onwrite.bind(void 0, stream), this.writecb = null, this.writelen = 0, this.afterWriteTickInfo = null, resetBuffer(this), this.pendingcb = 0, this.constructed = !0, this.prefinished = !1, this.errorEmitted = !1, this.emitClose = !options || options.emitClose !== !1, this.autoDestroy = !options || options.autoDestroy !== !1, this.errored = null, this.closed = !1, this.closeEmitted = !1, this[kOnFinished] = [];
    }
    function resetBuffer(state) {
      state.buffered = [], state.bufferedIndex = 0, state.allBuffers = !0, state.allNoop = !0;
    }
    WritableState.prototype.getBuffer = function() {
      return ArrayPrototypeSlice(this.buffered, this.bufferedIndex);
    };
    ObjectDefineProperty(WritableState.prototype, "bufferedRequestCount", {
      __proto__: null,
      get() {
        return this.buffered.length - this.bufferedIndex;
      }
    });
    function Writable3(options) {
      let isDuplex = this instanceof require_duplex();
      if (!isDuplex && !FunctionPrototypeSymbolHasInstance(Writable3, this)) return new Writable3(options);
      this._writableState = new WritableState(options, this, isDuplex), options && (typeof options.write == "function" && (this._write = options.write), typeof options.writev == "function" && (this._writev = options.writev), typeof options.destroy == "function" && (this._destroy = options.destroy), typeof options.final == "function" && (this._final = options.final), typeof options.construct == "function" && (this._construct = options.construct), options.signal && addAbortSignal(options.signal, this)), Stream.call(this, options), destroyImpl.construct(this, () => {
        let state = this._writableState;
        state.writing || clearBuffer(this, state), finishMaybe(this, state);
      });
    }
    ObjectDefineProperty(Writable3, SymbolHasInstance, {
      __proto__: null,
      value: function(object) {
        return FunctionPrototypeSymbolHasInstance(this, object) ? !0 : this !== Writable3 ? !1 : object && object._writableState instanceof WritableState;
      }
    });
    Writable3.prototype.pipe = function() {
      errorOrDestroy(this, new ERR_STREAM_CANNOT_PIPE());
    };
    function _write(stream, chunk, encoding, cb) {
      let state = stream._writableState;
      if (typeof encoding == "function")
        cb = encoding, encoding = state.defaultEncoding;
      else {
        if (!encoding) encoding = state.defaultEncoding;
        else if (encoding !== "buffer" && !Buffer6.isEncoding(encoding)) throw new ERR_UNKNOWN_ENCODING(encoding);
        typeof cb != "function" && (cb = nop);
      }
      if (chunk === null)
        throw new ERR_STREAM_NULL_VALUES();
      if (!state.objectMode)
        if (typeof chunk == "string")
          state.decodeStrings !== !1 && (chunk = Buffer6.from(chunk, encoding), encoding = "buffer");
        else if (chunk instanceof Buffer6)
          encoding = "buffer";
        else if (Stream._isUint8Array(chunk))
          chunk = Stream._uint8ArrayToBuffer(chunk), encoding = "buffer";
        else
          throw new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "Uint8Array"], chunk);
      let err;
      return state.ending ? err = new ERR_STREAM_WRITE_AFTER_END() : state.destroyed && (err = new ERR_STREAM_DESTROYED("write")), err ? (process.nextTick(cb, err), errorOrDestroy(stream, err, !0), err) : (state.pendingcb++, writeOrBuffer(stream, state, chunk, encoding, cb));
    }
    Writable3.prototype.write = function(chunk, encoding, cb) {
      return _write(this, chunk, encoding, cb) === !0;
    };
    Writable3.prototype.cork = function() {
      this._writableState.corked++;
    };
    Writable3.prototype.uncork = function() {
      let state = this._writableState;
      state.corked && (state.corked--, state.writing || clearBuffer(this, state));
    };
    Writable3.prototype.setDefaultEncoding = function(encoding) {
      if (typeof encoding == "string" && (encoding = StringPrototypeToLowerCase(encoding)), !Buffer6.isEncoding(encoding)) throw new ERR_UNKNOWN_ENCODING(encoding);
      return this._writableState.defaultEncoding = encoding, this;
    };
    function writeOrBuffer(stream, state, chunk, encoding, callback) {
      let len = state.objectMode ? 1 : chunk.length;
      state.length += len;
      let ret = state.length < state.highWaterMark;
      return ret || (state.needDrain = !0), state.writing || state.corked || state.errored || !state.constructed ? (state.buffered.push({
        chunk,
        encoding,
        callback
      }), state.allBuffers && encoding !== "buffer" && (state.allBuffers = !1), state.allNoop && callback !== nop && (state.allNoop = !1)) : (state.writelen = len, state.writecb = callback, state.writing = !0, state.sync = !0, stream._write(chunk, encoding, state.onwrite), state.sync = !1), ret && !state.errored && !state.destroyed;
    }
    function doWrite(stream, state, writev, len, chunk, encoding, cb) {
      state.writelen = len, state.writecb = cb, state.writing = !0, state.sync = !0, state.destroyed ? state.onwrite(new ERR_STREAM_DESTROYED("write")) : writev ? stream._writev(chunk, state.onwrite) : stream._write(chunk, encoding, state.onwrite), state.sync = !1;
    }
    function onwriteError(stream, state, er, cb) {
      --state.pendingcb, cb(er), errorBuffer(state), errorOrDestroy(stream, er);
    }
    function onwrite(stream, er) {
      let state = stream._writableState, sync = state.sync, cb = state.writecb;
      if (typeof cb != "function") {
        errorOrDestroy(stream, new ERR_MULTIPLE_CALLBACK());
        return;
      }
      state.writing = !1, state.writecb = null, state.length -= state.writelen, state.writelen = 0, er ? (er.stack, state.errored || (state.errored = er), stream._readableState && !stream._readableState.errored && (stream._readableState.errored = er), sync ? process.nextTick(onwriteError, stream, state, er, cb) : onwriteError(stream, state, er, cb)) : (state.buffered.length > state.bufferedIndex && clearBuffer(stream, state), sync ? state.afterWriteTickInfo !== null && state.afterWriteTickInfo.cb === cb ? state.afterWriteTickInfo.count++ : (state.afterWriteTickInfo = {
        count: 1,
        cb,
        stream,
        state
      }, process.nextTick(afterWriteTick, state.afterWriteTickInfo)) : afterWrite(stream, state, 1, cb));
    }
    function afterWriteTick({ stream, state, count, cb }) {
      return state.afterWriteTickInfo = null, afterWrite(stream, state, count, cb);
    }
    function afterWrite(stream, state, count, cb) {
      for (!state.ending && !stream.destroyed && state.length === 0 && state.needDrain && (state.needDrain = !1, stream.emit("drain")); count-- > 0; )
        state.pendingcb--, cb();
      state.destroyed && errorBuffer(state), finishMaybe(stream, state);
    }
    function errorBuffer(state) {
      if (state.writing)
        return;
      for (let n = state.bufferedIndex; n < state.buffered.length; ++n) {
        var _state$errored;
        let { chunk, callback } = state.buffered[n], len = state.objectMode ? 1 : chunk.length;
        state.length -= len, callback(
          (_state$errored = state.errored) !== null && _state$errored !== void 0 ? _state$errored : new ERR_STREAM_DESTROYED("write")
        );
      }
      let onfinishCallbacks = state[kOnFinished].splice(0);
      for (let i = 0; i < onfinishCallbacks.length; i++) {
        var _state$errored2;
        onfinishCallbacks[i](
          (_state$errored2 = state.errored) !== null && _state$errored2 !== void 0 ? _state$errored2 : new ERR_STREAM_DESTROYED("end")
        );
      }
      resetBuffer(state);
    }
    function clearBuffer(stream, state) {
      if (state.corked || state.bufferProcessing || state.destroyed || !state.constructed)
        return;
      let { buffered, bufferedIndex, objectMode } = state, bufferedLength = buffered.length - bufferedIndex;
      if (!bufferedLength)
        return;
      let i = bufferedIndex;
      if (state.bufferProcessing = !0, bufferedLength > 1 && stream._writev) {
        state.pendingcb -= bufferedLength - 1;
        let callback = state.allNoop ? nop : (err) => {
          for (let n = i; n < buffered.length; ++n)
            buffered[n].callback(err);
        }, chunks = state.allNoop && i === 0 ? buffered : ArrayPrototypeSlice(buffered, i);
        chunks.allBuffers = state.allBuffers, doWrite(stream, state, !0, state.length, chunks, "", callback), resetBuffer(state);
      } else {
        do {
          let { chunk, encoding, callback } = buffered[i];
          buffered[i++] = null;
          let len = objectMode ? 1 : chunk.length;
          doWrite(stream, state, !1, len, chunk, encoding, callback);
        } while (i < buffered.length && !state.writing);
        i === buffered.length ? resetBuffer(state) : i > 256 ? (buffered.splice(0, i), state.bufferedIndex = 0) : state.bufferedIndex = i;
      }
      state.bufferProcessing = !1;
    }
    Writable3.prototype._write = function(chunk, encoding, cb) {
      if (this._writev)
        this._writev(
          [
            {
              chunk,
              encoding
            }
          ],
          cb
        );
      else
        throw new ERR_METHOD_NOT_IMPLEMENTED("_write()");
    };
    Writable3.prototype._writev = null;
    Writable3.prototype.end = function(chunk, encoding, cb) {
      let state = this._writableState;
      typeof chunk == "function" ? (cb = chunk, chunk = null, encoding = null) : typeof encoding == "function" && (cb = encoding, encoding = null);
      let err;
      if (chunk != null) {
        let ret = _write(this, chunk, encoding);
        ret instanceof Error2 && (err = ret);
      }
      return state.corked && (state.corked = 1, this.uncork()), err || (!state.errored && !state.ending ? (state.ending = !0, finishMaybe(this, state, !0), state.ended = !0) : state.finished ? err = new ERR_STREAM_ALREADY_FINISHED("end") : state.destroyed && (err = new ERR_STREAM_DESTROYED("end"))), typeof cb == "function" && (err || state.finished ? process.nextTick(cb, err) : state[kOnFinished].push(cb)), this;
    };
    function needFinish(state) {
      return state.ending && !state.destroyed && state.constructed && state.length === 0 && !state.errored && state.buffered.length === 0 && !state.finished && !state.writing && !state.errorEmitted && !state.closeEmitted;
    }
    function callFinal(stream, state) {
      let called = !1;
      function onFinish(err) {
        if (called) {
          errorOrDestroy(stream, err ?? ERR_MULTIPLE_CALLBACK());
          return;
        }
        if (called = !0, state.pendingcb--, err) {
          let onfinishCallbacks = state[kOnFinished].splice(0);
          for (let i = 0; i < onfinishCallbacks.length; i++)
            onfinishCallbacks[i](err);
          errorOrDestroy(stream, err, state.sync);
        } else needFinish(state) && (state.prefinished = !0, stream.emit("prefinish"), state.pendingcb++, process.nextTick(finish, stream, state));
      }
      state.sync = !0, state.pendingcb++;
      try {
        stream._final(onFinish);
      } catch (err) {
        onFinish(err);
      }
      state.sync = !1;
    }
    function prefinish(stream, state) {
      !state.prefinished && !state.finalCalled && (typeof stream._final == "function" && !state.destroyed ? (state.finalCalled = !0, callFinal(stream, state)) : (state.prefinished = !0, stream.emit("prefinish")));
    }
    function finishMaybe(stream, state, sync) {
      needFinish(state) && (prefinish(stream, state), state.pendingcb === 0 && (sync ? (state.pendingcb++, process.nextTick(
        (stream2, state2) => {
          needFinish(state2) ? finish(stream2, state2) : state2.pendingcb--;
        },
        stream,
        state
      )) : needFinish(state) && (state.pendingcb++, finish(stream, state))));
    }
    function finish(stream, state) {
      state.pendingcb--, state.finished = !0;
      let onfinishCallbacks = state[kOnFinished].splice(0);
      for (let i = 0; i < onfinishCallbacks.length; i++)
        onfinishCallbacks[i]();
      if (stream.emit("finish"), state.autoDestroy) {
        let rState = stream._readableState;
        (!rState || rState.autoDestroy && // We don't expect the readable to ever 'end'
        // if readable is explicitly set to false.
        (rState.endEmitted || rState.readable === !1)) && stream.destroy();
      }
    }
    ObjectDefineProperties(Writable3.prototype, {
      closed: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.closed : !1;
        }
      },
      destroyed: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.destroyed : !1;
        },
        set(value) {
          this._writableState && (this._writableState.destroyed = value);
        }
      },
      writable: {
        __proto__: null,
        get() {
          let w = this._writableState;
          return !!w && w.writable !== !1 && !w.destroyed && !w.errored && !w.ending && !w.ended;
        },
        set(val) {
          this._writableState && (this._writableState.writable = !!val);
        }
      },
      writableFinished: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.finished : !1;
        }
      },
      writableObjectMode: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.objectMode : !1;
        }
      },
      writableBuffer: {
        __proto__: null,
        get() {
          return this._writableState && this._writableState.getBuffer();
        }
      },
      writableEnded: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.ending : !1;
        }
      },
      writableNeedDrain: {
        __proto__: null,
        get() {
          let wState = this._writableState;
          return wState ? !wState.destroyed && !wState.ending && wState.needDrain : !1;
        }
      },
      writableHighWaterMark: {
        __proto__: null,
        get() {
          return this._writableState && this._writableState.highWaterMark;
        }
      },
      writableCorked: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.corked : 0;
        }
      },
      writableLength: {
        __proto__: null,
        get() {
          return this._writableState && this._writableState.length;
        }
      },
      errored: {
        __proto__: null,
        enumerable: !1,
        get() {
          return this._writableState ? this._writableState.errored : null;
        }
      },
      writableAborted: {
        __proto__: null,
        enumerable: !1,
        get: function() {
          return !!(this._writableState.writable !== !1 && (this._writableState.destroyed || this._writableState.errored) && !this._writableState.finished);
        }
      }
    });
    var destroy = destroyImpl.destroy;
    Writable3.prototype.destroy = function(err, cb) {
      let state = this._writableState;
      return !state.destroyed && (state.bufferedIndex < state.buffered.length || state[kOnFinished].length) && process.nextTick(errorBuffer, state), destroy.call(this, err, cb), this;
    };
    Writable3.prototype._undestroy = destroyImpl.undestroy;
    Writable3.prototype._destroy = function(err, cb) {
      cb(err);
    };
    Writable3.prototype[EE.captureRejectionSymbol] = function(err) {
      this.destroy(err);
    };
    var webStreamsAdapters;
    function lazyWebStreams() {
      return webStreamsAdapters === void 0 && (webStreamsAdapters = {}), webStreamsAdapters;
    }
    Writable3.fromWeb = function(writableStream, options) {
      return lazyWebStreams().newStreamWritableFromWritableStream(writableStream, options);
    };
    Writable3.toWeb = function(streamWritable) {
      return lazyWebStreams().newWritableStreamFromStreamWritable(streamWritable);
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/duplexify.js
var require_duplexify = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/duplexify.js"(exports, module) {
    var process = require_process(), bufferModule = require_buffer(), {
      isReadable,
      isWritable,
      isIterable,
      isNodeStream,
      isReadableNodeStream,
      isWritableNodeStream,
      isDuplexNodeStream,
      isReadableStream,
      isWritableStream
    } = require_utils(), eos = require_end_of_stream(), {
      AbortError,
      codes: { ERR_INVALID_ARG_TYPE, ERR_INVALID_RETURN_VALUE }
    } = require_errors(), { destroyer } = require_destroy(), Duplex = require_duplex(), Readable3 = require_readable(), Writable3 = require_writable(), { createDeferredPromise } = require_util(), from = require_from(), Blob2 = globalThis.Blob || bufferModule.Blob, isBlob = typeof Blob2 < "u" ? function(b) {
      return b instanceof Blob2;
    } : function(b) {
      return !1;
    }, AbortController2 = globalThis.AbortController || require_abort_controller().AbortController, { FunctionPrototypeCall } = require_primordials(), Duplexify = class extends Duplex {
      constructor(options) {
        super(options), options?.readable === !1 && (this._readableState.readable = !1, this._readableState.ended = !0, this._readableState.endEmitted = !0), options?.writable === !1 && (this._writableState.writable = !1, this._writableState.ending = !0, this._writableState.ended = !0, this._writableState.finished = !0);
      }
    };
    module.exports = function duplexify(body, name) {
      if (isDuplexNodeStream(body))
        return body;
      if (isReadableNodeStream(body))
        return _duplexify({
          readable: body
        });
      if (isWritableNodeStream(body))
        return _duplexify({
          writable: body
        });
      if (isNodeStream(body))
        return _duplexify({
          writable: !1,
          readable: !1
        });
      if (isReadableStream(body))
        return _duplexify({
          readable: Readable3.fromWeb(body)
        });
      if (isWritableStream(body))
        return _duplexify({
          writable: Writable3.fromWeb(body)
        });
      if (typeof body == "function") {
        let { value, write, final, destroy } = fromAsyncGen(body);
        if (isIterable(value))
          return from(Duplexify, value, {
            // TODO (ronag): highWaterMark?
            objectMode: !0,
            write,
            final,
            destroy
          });
        let then2 = value?.then;
        if (typeof then2 == "function") {
          let d, promise = FunctionPrototypeCall(
            then2,
            value,
            (val) => {
              if (val != null)
                throw new ERR_INVALID_RETURN_VALUE("nully", "body", val);
            },
            (err) => {
              destroyer(d, err);
            }
          );
          return d = new Duplexify({
            // TODO (ronag): highWaterMark?
            objectMode: !0,
            readable: !1,
            write,
            final(cb) {
              final(async () => {
                try {
                  await promise, process.nextTick(cb, null);
                } catch (err) {
                  process.nextTick(cb, err);
                }
              });
            },
            destroy
          });
        }
        throw new ERR_INVALID_RETURN_VALUE("Iterable, AsyncIterable or AsyncFunction", name, value);
      }
      if (isBlob(body))
        return duplexify(body.arrayBuffer());
      if (isIterable(body))
        return from(Duplexify, body, {
          // TODO (ronag): highWaterMark?
          objectMode: !0,
          writable: !1
        });
      if (isReadableStream(body?.readable) && isWritableStream(body?.writable))
        return Duplexify.fromWeb(body);
      if (typeof body?.writable == "object" || typeof body?.readable == "object") {
        let readable = body != null && body.readable ? isReadableNodeStream(body?.readable) ? body?.readable : duplexify(body.readable) : void 0, writable = body != null && body.writable ? isWritableNodeStream(body?.writable) ? body?.writable : duplexify(body.writable) : void 0;
        return _duplexify({
          readable,
          writable
        });
      }
      let then = body?.then;
      if (typeof then == "function") {
        let d;
        return FunctionPrototypeCall(
          then,
          body,
          (val) => {
            val != null && d.push(val), d.push(null);
          },
          (err) => {
            destroyer(d, err);
          }
        ), d = new Duplexify({
          objectMode: !0,
          writable: !1,
          read() {
          }
        });
      }
      throw new ERR_INVALID_ARG_TYPE(
        name,
        [
          "Blob",
          "ReadableStream",
          "WritableStream",
          "Stream",
          "Iterable",
          "AsyncIterable",
          "Function",
          "{ readable, writable } pair",
          "Promise"
        ],
        body
      );
    };
    function fromAsyncGen(fn) {
      let { promise, resolve: resolve2 } = createDeferredPromise(), ac = new AbortController2(), signal = ac.signal;
      return {
        value: fn(
          (async function* () {
            for (; ; ) {
              let _promise = promise;
              promise = null;
              let { chunk, done, cb } = await _promise;
              if (process.nextTick(cb), done) return;
              if (signal.aborted)
                throw new AbortError(void 0, {
                  cause: signal.reason
                });
              ({ promise, resolve: resolve2 } = createDeferredPromise()), yield chunk;
            }
          })(),
          {
            signal
          }
        ),
        write(chunk, encoding, cb) {
          let _resolve = resolve2;
          resolve2 = null, _resolve({
            chunk,
            done: !1,
            cb
          });
        },
        final(cb) {
          let _resolve = resolve2;
          resolve2 = null, _resolve({
            done: !0,
            cb
          });
        },
        destroy(err, cb) {
          ac.abort(), cb(err);
        }
      };
    }
    function _duplexify(pair) {
      let r = pair.readable && typeof pair.readable.read != "function" ? Readable3.wrap(pair.readable) : pair.readable, w = pair.writable, readable = !!isReadable(r), writable = !!isWritable(w), ondrain, onfinish, onreadable, onclose, d;
      function onfinished(err) {
        let cb = onclose;
        onclose = null, cb ? cb(err) : err && d.destroy(err);
      }
      return d = new Duplexify({
        // TODO (ronag): highWaterMark?
        readableObjectMode: !!(r != null && r.readableObjectMode),
        writableObjectMode: !!(w != null && w.writableObjectMode),
        readable,
        writable
      }), writable && (eos(w, (err) => {
        writable = !1, err && destroyer(r, err), onfinished(err);
      }), d._write = function(chunk, encoding, callback) {
        w.write(chunk, encoding) ? callback() : ondrain = callback;
      }, d._final = function(callback) {
        w.end(), onfinish = callback;
      }, w.on("drain", function() {
        if (ondrain) {
          let cb = ondrain;
          ondrain = null, cb();
        }
      }), w.on("finish", function() {
        if (onfinish) {
          let cb = onfinish;
          onfinish = null, cb();
        }
      })), readable && (eos(r, (err) => {
        readable = !1, err && destroyer(r, err), onfinished(err);
      }), r.on("readable", function() {
        if (onreadable) {
          let cb = onreadable;
          onreadable = null, cb();
        }
      }), r.on("end", function() {
        d.push(null);
      }), d._read = function() {
        for (; ; ) {
          let buf = r.read();
          if (buf === null) {
            onreadable = d._read;
            return;
          }
          if (!d.push(buf))
            return;
        }
      }), d._destroy = function(err, callback) {
        !err && onclose !== null && (err = new AbortError()), onreadable = null, ondrain = null, onfinish = null, onclose === null ? callback(err) : (onclose = callback, destroyer(w, err), destroyer(r, err));
      }, d;
    }
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/duplex.js
var require_duplex = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/duplex.js"(exports, module) {
    "use strict";
    var {
      ObjectDefineProperties,
      ObjectGetOwnPropertyDescriptor,
      ObjectKeys,
      ObjectSetPrototypeOf
    } = require_primordials();
    module.exports = Duplex;
    var Readable3 = require_readable(), Writable3 = require_writable();
    ObjectSetPrototypeOf(Duplex.prototype, Readable3.prototype);
    ObjectSetPrototypeOf(Duplex, Readable3);
    {
      let keys = ObjectKeys(Writable3.prototype);
      for (let i = 0; i < keys.length; i++) {
        let method = keys[i];
        Duplex.prototype[method] || (Duplex.prototype[method] = Writable3.prototype[method]);
      }
    }
    function Duplex(options) {
      if (!(this instanceof Duplex)) return new Duplex(options);
      Readable3.call(this, options), Writable3.call(this, options), options ? (this.allowHalfOpen = options.allowHalfOpen !== !1, options.readable === !1 && (this._readableState.readable = !1, this._readableState.ended = !0, this._readableState.endEmitted = !0), options.writable === !1 && (this._writableState.writable = !1, this._writableState.ending = !0, this._writableState.ended = !0, this._writableState.finished = !0)) : this.allowHalfOpen = !0;
    }
    ObjectDefineProperties(Duplex.prototype, {
      writable: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable3.prototype, "writable")
      },
      writableHighWaterMark: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable3.prototype, "writableHighWaterMark")
      },
      writableObjectMode: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable3.prototype, "writableObjectMode")
      },
      writableBuffer: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable3.prototype, "writableBuffer")
      },
      writableLength: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable3.prototype, "writableLength")
      },
      writableFinished: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable3.prototype, "writableFinished")
      },
      writableCorked: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable3.prototype, "writableCorked")
      },
      writableEnded: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable3.prototype, "writableEnded")
      },
      writableNeedDrain: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable3.prototype, "writableNeedDrain")
      },
      destroyed: {
        __proto__: null,
        get() {
          return this._readableState === void 0 || this._writableState === void 0 ? !1 : this._readableState.destroyed && this._writableState.destroyed;
        },
        set(value) {
          this._readableState && this._writableState && (this._readableState.destroyed = value, this._writableState.destroyed = value);
        }
      }
    });
    var webStreamsAdapters;
    function lazyWebStreams() {
      return webStreamsAdapters === void 0 && (webStreamsAdapters = {}), webStreamsAdapters;
    }
    Duplex.fromWeb = function(pair, options) {
      return lazyWebStreams().newStreamDuplexFromReadableWritablePair(pair, options);
    };
    Duplex.toWeb = function(duplex) {
      return lazyWebStreams().newReadableWritablePairFromDuplex(duplex);
    };
    var duplexify;
    Duplex.from = function(body) {
      return duplexify || (duplexify = require_duplexify()), duplexify(body, "body");
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/transform.js
var require_transform = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/transform.js"(exports, module) {
    "use strict";
    var { ObjectSetPrototypeOf, Symbol: Symbol2 } = require_primordials();
    module.exports = Transform;
    var { ERR_METHOD_NOT_IMPLEMENTED } = require_errors().codes, Duplex = require_duplex(), { getHighWaterMark } = require_state();
    ObjectSetPrototypeOf(Transform.prototype, Duplex.prototype);
    ObjectSetPrototypeOf(Transform, Duplex);
    var kCallback = Symbol2("kCallback");
    function Transform(options) {
      if (!(this instanceof Transform)) return new Transform(options);
      let readableHighWaterMark = options ? getHighWaterMark(this, options, "readableHighWaterMark", !0) : null;
      readableHighWaterMark === 0 && (options = {
        ...options,
        highWaterMark: null,
        readableHighWaterMark,
        // TODO (ronag): 0 is not optimal since we have
        // a "bug" where we check needDrain before calling _write and not after.
        // Refs: https://github.com/nodejs/node/pull/32887
        // Refs: https://github.com/nodejs/node/pull/35941
        writableHighWaterMark: options.writableHighWaterMark || 0
      }), Duplex.call(this, options), this._readableState.sync = !1, this[kCallback] = null, options && (typeof options.transform == "function" && (this._transform = options.transform), typeof options.flush == "function" && (this._flush = options.flush)), this.on("prefinish", prefinish);
    }
    function final(cb) {
      typeof this._flush == "function" && !this.destroyed ? this._flush((er, data) => {
        if (er) {
          cb ? cb(er) : this.destroy(er);
          return;
        }
        data != null && this.push(data), this.push(null), cb && cb();
      }) : (this.push(null), cb && cb());
    }
    function prefinish() {
      this._final !== final && final.call(this);
    }
    Transform.prototype._final = final;
    Transform.prototype._transform = function(chunk, encoding, callback) {
      throw new ERR_METHOD_NOT_IMPLEMENTED("_transform()");
    };
    Transform.prototype._write = function(chunk, encoding, callback) {
      let rState = this._readableState, wState = this._writableState, length = rState.length;
      this._transform(chunk, encoding, (err, val) => {
        if (err) {
          callback(err);
          return;
        }
        val != null && this.push(val), wState.ended || // Backwards compat.
        length === rState.length || // Backwards compat.
        rState.length < rState.highWaterMark ? callback() : this[kCallback] = callback;
      });
    };
    Transform.prototype._read = function() {
      if (this[kCallback]) {
        let callback = this[kCallback];
        this[kCallback] = null, callback();
      }
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/passthrough.js
var require_passthrough = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/passthrough.js"(exports, module) {
    "use strict";
    var { ObjectSetPrototypeOf } = require_primordials();
    module.exports = PassThrough;
    var Transform = require_transform();
    ObjectSetPrototypeOf(PassThrough.prototype, Transform.prototype);
    ObjectSetPrototypeOf(PassThrough, Transform);
    function PassThrough(options) {
      if (!(this instanceof PassThrough)) return new PassThrough(options);
      Transform.call(this, options);
    }
    PassThrough.prototype._transform = function(chunk, encoding, cb) {
      cb(null, chunk);
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/pipeline.js
var require_pipeline = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/pipeline.js"(exports, module) {
    var process = require_process(), { ArrayIsArray, Promise: Promise2, SymbolAsyncIterator, SymbolDispose } = require_primordials(), eos = require_end_of_stream(), { once } = require_util(), destroyImpl = require_destroy(), Duplex = require_duplex(), {
      aggregateTwoErrors,
      codes: {
        ERR_INVALID_ARG_TYPE,
        ERR_INVALID_RETURN_VALUE,
        ERR_MISSING_ARGS,
        ERR_STREAM_DESTROYED,
        ERR_STREAM_PREMATURE_CLOSE
      },
      AbortError
    } = require_errors(), { validateFunction, validateAbortSignal } = require_validators(), {
      isIterable,
      isReadable,
      isReadableNodeStream,
      isNodeStream,
      isTransformStream,
      isWebStream,
      isReadableStream,
      isReadableFinished
    } = require_utils(), AbortController2 = globalThis.AbortController || require_abort_controller().AbortController, PassThrough, Readable3, addAbortListener;
    function destroyer(stream, reading, writing) {
      let finished = !1;
      stream.on("close", () => {
        finished = !0;
      });
      let cleanup = eos(
        stream,
        {
          readable: reading,
          writable: writing
        },
        (err) => {
          finished = !err;
        }
      );
      return {
        destroy: (err) => {
          finished || (finished = !0, destroyImpl.destroyer(stream, err || new ERR_STREAM_DESTROYED("pipe")));
        },
        cleanup
      };
    }
    function popCallback(streams) {
      return validateFunction(streams[streams.length - 1], "streams[stream.length - 1]"), streams.pop();
    }
    function makeAsyncIterable(val) {
      if (isIterable(val))
        return val;
      if (isReadableNodeStream(val))
        return fromReadable(val);
      throw new ERR_INVALID_ARG_TYPE("val", ["Readable", "Iterable", "AsyncIterable"], val);
    }
    async function* fromReadable(val) {
      Readable3 || (Readable3 = require_readable()), yield* Readable3.prototype[SymbolAsyncIterator].call(val);
    }
    async function pumpToNode(iterable, writable, finish, { end }) {
      let error, onresolve = null, resume = (err) => {
        if (err && (error = err), onresolve) {
          let callback = onresolve;
          onresolve = null, callback();
        }
      }, wait = () => new Promise2((resolve2, reject) => {
        error ? reject(error) : onresolve = () => {
          error ? reject(error) : resolve2();
        };
      });
      writable.on("drain", resume);
      let cleanup = eos(
        writable,
        {
          readable: !1
        },
        resume
      );
      try {
        writable.writableNeedDrain && await wait();
        for await (let chunk of iterable)
          writable.write(chunk) || await wait();
        end && (writable.end(), await wait()), finish();
      } catch (err) {
        finish(error !== err ? aggregateTwoErrors(error, err) : err);
      } finally {
        cleanup(), writable.off("drain", resume);
      }
    }
    async function pumpToWeb(readable, writable, finish, { end }) {
      isTransformStream(writable) && (writable = writable.writable);
      let writer = writable.getWriter();
      try {
        for await (let chunk of readable)
          await writer.ready, writer.write(chunk).catch(() => {
          });
        await writer.ready, end && await writer.close(), finish();
      } catch (err) {
        try {
          await writer.abort(err), finish(err);
        } catch (err2) {
          finish(err2);
        }
      }
    }
    function pipeline(...streams) {
      return pipelineImpl(streams, once(popCallback(streams)));
    }
    function pipelineImpl(streams, callback, opts) {
      if (streams.length === 1 && ArrayIsArray(streams[0]) && (streams = streams[0]), streams.length < 2)
        throw new ERR_MISSING_ARGS("streams");
      let ac = new AbortController2(), signal = ac.signal, outerSignal = opts?.signal, lastStreamCleanup = [];
      validateAbortSignal(outerSignal, "options.signal");
      function abort() {
        finishImpl(new AbortError());
      }
      addAbortListener = addAbortListener || require_util().addAbortListener;
      let disposable;
      outerSignal && (disposable = addAbortListener(outerSignal, abort));
      let error, value, destroys = [], finishCount = 0;
      function finish(err) {
        finishImpl(err, --finishCount === 0);
      }
      function finishImpl(err, final) {
        var _disposable;
        if (err && (!error || error.code === "ERR_STREAM_PREMATURE_CLOSE") && (error = err), !(!error && !final)) {
          for (; destroys.length; )
            destroys.shift()(error);
          (_disposable = disposable) === null || _disposable === void 0 || _disposable[SymbolDispose](), ac.abort(), final && (error || lastStreamCleanup.forEach((fn) => fn()), process.nextTick(callback, error, value));
        }
      }
      let ret;
      for (let i = 0; i < streams.length; i++) {
        let stream = streams[i], reading = i < streams.length - 1, writing = i > 0, end = reading || opts?.end !== !1, isLastStream = i === streams.length - 1;
        if (isNodeStream(stream)) {
          let onError2 = function(err) {
            err && err.name !== "AbortError" && err.code !== "ERR_STREAM_PREMATURE_CLOSE" && finish(err);
          };
          var onError = onError2;
          if (end) {
            let { destroy, cleanup } = destroyer(stream, reading, writing);
            destroys.push(destroy), isReadable(stream) && isLastStream && lastStreamCleanup.push(cleanup);
          }
          stream.on("error", onError2), isReadable(stream) && isLastStream && lastStreamCleanup.push(() => {
            stream.removeListener("error", onError2);
          });
        }
        if (i === 0)
          if (typeof stream == "function") {
            if (ret = stream({
              signal
            }), !isIterable(ret))
              throw new ERR_INVALID_RETURN_VALUE("Iterable, AsyncIterable or Stream", "source", ret);
          } else isIterable(stream) || isReadableNodeStream(stream) || isTransformStream(stream) ? ret = stream : ret = Duplex.from(stream);
        else if (typeof stream == "function") {
          if (isTransformStream(ret)) {
            var _ret;
            ret = makeAsyncIterable((_ret = ret) === null || _ret === void 0 ? void 0 : _ret.readable);
          } else
            ret = makeAsyncIterable(ret);
          if (ret = stream(ret, {
            signal
          }), reading) {
            if (!isIterable(ret, !0))
              throw new ERR_INVALID_RETURN_VALUE("AsyncIterable", `transform[${i - 1}]`, ret);
          } else {
            var _ret2;
            PassThrough || (PassThrough = require_passthrough());
            let pt = new PassThrough({
              objectMode: !0
            }), then = (_ret2 = ret) === null || _ret2 === void 0 ? void 0 : _ret2.then;
            if (typeof then == "function")
              finishCount++, then.call(
                ret,
                (val) => {
                  value = val, val != null && pt.write(val), end && pt.end(), process.nextTick(finish);
                },
                (err) => {
                  pt.destroy(err), process.nextTick(finish, err);
                }
              );
            else if (isIterable(ret, !0))
              finishCount++, pumpToNode(ret, pt, finish, {
                end
              });
            else if (isReadableStream(ret) || isTransformStream(ret)) {
              let toRead = ret.readable || ret;
              finishCount++, pumpToNode(toRead, pt, finish, {
                end
              });
            } else
              throw new ERR_INVALID_RETURN_VALUE("AsyncIterable or Promise", "destination", ret);
            ret = pt;
            let { destroy, cleanup } = destroyer(ret, !1, !0);
            destroys.push(destroy), isLastStream && lastStreamCleanup.push(cleanup);
          }
        } else if (isNodeStream(stream)) {
          if (isReadableNodeStream(ret)) {
            finishCount += 2;
            let cleanup = pipe(ret, stream, finish, {
              end
            });
            isReadable(stream) && isLastStream && lastStreamCleanup.push(cleanup);
          } else if (isTransformStream(ret) || isReadableStream(ret)) {
            let toRead = ret.readable || ret;
            finishCount++, pumpToNode(toRead, stream, finish, {
              end
            });
          } else if (isIterable(ret))
            finishCount++, pumpToNode(ret, stream, finish, {
              end
            });
          else
            throw new ERR_INVALID_ARG_TYPE(
              "val",
              ["Readable", "Iterable", "AsyncIterable", "ReadableStream", "TransformStream"],
              ret
            );
          ret = stream;
        } else if (isWebStream(stream)) {
          if (isReadableNodeStream(ret))
            finishCount++, pumpToWeb(makeAsyncIterable(ret), stream, finish, {
              end
            });
          else if (isReadableStream(ret) || isIterable(ret))
            finishCount++, pumpToWeb(ret, stream, finish, {
              end
            });
          else if (isTransformStream(ret))
            finishCount++, pumpToWeb(ret.readable, stream, finish, {
              end
            });
          else
            throw new ERR_INVALID_ARG_TYPE(
              "val",
              ["Readable", "Iterable", "AsyncIterable", "ReadableStream", "TransformStream"],
              ret
            );
          ret = stream;
        } else
          ret = Duplex.from(stream);
      }
      return (signal != null && signal.aborted || outerSignal != null && outerSignal.aborted) && process.nextTick(abort), ret;
    }
    function pipe(src, dst, finish, { end }) {
      let ended = !1;
      if (dst.on("close", () => {
        ended || finish(new ERR_STREAM_PREMATURE_CLOSE());
      }), src.pipe(dst, {
        end: !1
      }), end) {
        let endFn2 = function() {
          ended = !0, dst.end();
        };
        var endFn = endFn2;
        isReadableFinished(src) ? process.nextTick(endFn2) : src.once("end", endFn2);
      } else
        finish();
      return eos(
        src,
        {
          readable: !0,
          writable: !1
        },
        (err) => {
          let rState = src._readableState;
          err && err.code === "ERR_STREAM_PREMATURE_CLOSE" && rState && rState.ended && !rState.errored && !rState.errorEmitted ? src.once("end", finish).once("error", finish) : finish(err);
        }
      ), eos(
        dst,
        {
          readable: !1,
          writable: !0
        },
        finish
      );
    }
    module.exports = {
      pipelineImpl,
      pipeline
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/compose.js
var require_compose = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/compose.js"(exports, module) {
    "use strict";
    var { pipeline } = require_pipeline(), Duplex = require_duplex(), { destroyer } = require_destroy(), {
      isNodeStream,
      isReadable,
      isWritable,
      isWebStream,
      isTransformStream,
      isWritableStream,
      isReadableStream
    } = require_utils(), {
      AbortError,
      codes: { ERR_INVALID_ARG_VALUE, ERR_MISSING_ARGS }
    } = require_errors(), eos = require_end_of_stream();
    module.exports = function(...streams) {
      if (streams.length === 0)
        throw new ERR_MISSING_ARGS("streams");
      if (streams.length === 1)
        return Duplex.from(streams[0]);
      let orgStreams = [...streams];
      if (typeof streams[0] == "function" && (streams[0] = Duplex.from(streams[0])), typeof streams[streams.length - 1] == "function") {
        let idx = streams.length - 1;
        streams[idx] = Duplex.from(streams[idx]);
      }
      for (let n = 0; n < streams.length; ++n)
        if (!(!isNodeStream(streams[n]) && !isWebStream(streams[n]))) {
          if (n < streams.length - 1 && !(isReadable(streams[n]) || isReadableStream(streams[n]) || isTransformStream(streams[n])))
            throw new ERR_INVALID_ARG_VALUE(`streams[${n}]`, orgStreams[n], "must be readable");
          if (n > 0 && !(isWritable(streams[n]) || isWritableStream(streams[n]) || isTransformStream(streams[n])))
            throw new ERR_INVALID_ARG_VALUE(`streams[${n}]`, orgStreams[n], "must be writable");
        }
      let ondrain, onfinish, onreadable, onclose, d;
      function onfinished(err) {
        let cb = onclose;
        onclose = null, cb ? cb(err) : err ? d.destroy(err) : !readable && !writable && d.destroy();
      }
      let head = streams[0], tail = pipeline(streams, onfinished), writable = !!(isWritable(head) || isWritableStream(head) || isTransformStream(head)), readable = !!(isReadable(tail) || isReadableStream(tail) || isTransformStream(tail));
      if (d = new Duplex({
        // TODO (ronag): highWaterMark?
        writableObjectMode: !!(head != null && head.writableObjectMode),
        readableObjectMode: !!(tail != null && tail.readableObjectMode),
        writable,
        readable
      }), writable) {
        if (isNodeStream(head))
          d._write = function(chunk, encoding, callback) {
            head.write(chunk, encoding) ? callback() : ondrain = callback;
          }, d._final = function(callback) {
            head.end(), onfinish = callback;
          }, head.on("drain", function() {
            if (ondrain) {
              let cb = ondrain;
              ondrain = null, cb();
            }
          });
        else if (isWebStream(head)) {
          let writer = (isTransformStream(head) ? head.writable : head).getWriter();
          d._write = async function(chunk, encoding, callback) {
            try {
              await writer.ready, writer.write(chunk).catch(() => {
              }), callback();
            } catch (err) {
              callback(err);
            }
          }, d._final = async function(callback) {
            try {
              await writer.ready, writer.close().catch(() => {
              }), onfinish = callback;
            } catch (err) {
              callback(err);
            }
          };
        }
        let toRead = isTransformStream(tail) ? tail.readable : tail;
        eos(toRead, () => {
          if (onfinish) {
            let cb = onfinish;
            onfinish = null, cb();
          }
        });
      }
      if (readable) {
        if (isNodeStream(tail))
          tail.on("readable", function() {
            if (onreadable) {
              let cb = onreadable;
              onreadable = null, cb();
            }
          }), tail.on("end", function() {
            d.push(null);
          }), d._read = function() {
            for (; ; ) {
              let buf = tail.read();
              if (buf === null) {
                onreadable = d._read;
                return;
              }
              if (!d.push(buf))
                return;
            }
          };
        else if (isWebStream(tail)) {
          let reader = (isTransformStream(tail) ? tail.readable : tail).getReader();
          d._read = async function() {
            for (; ; )
              try {
                let { value, done } = await reader.read();
                if (!d.push(value))
                  return;
                if (done) {
                  d.push(null);
                  return;
                }
              } catch {
                return;
              }
          };
        }
      }
      return d._destroy = function(err, callback) {
        !err && onclose !== null && (err = new AbortError()), onreadable = null, ondrain = null, onfinish = null, onclose === null ? callback(err) : (onclose = callback, isNodeStream(tail) && destroyer(tail, err));
      }, d;
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/operators.js
var require_operators = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/internal/streams/operators.js"(exports, module) {
    "use strict";
    var AbortController2 = globalThis.AbortController || require_abort_controller().AbortController, {
      codes: { ERR_INVALID_ARG_VALUE, ERR_INVALID_ARG_TYPE, ERR_MISSING_ARGS, ERR_OUT_OF_RANGE },
      AbortError
    } = require_errors(), { validateAbortSignal, validateInteger, validateObject } = require_validators(), kWeakHandler = require_primordials().Symbol("kWeak"), kResistStopPropagation = require_primordials().Symbol("kResistStopPropagation"), { finished } = require_end_of_stream(), staticCompose = require_compose(), { addAbortSignalNoValidate } = require_add_abort_signal(), { isWritable, isNodeStream } = require_utils(), { deprecate: deprecate2 } = require_util(), {
      ArrayPrototypePush,
      Boolean: Boolean2,
      MathFloor,
      Number: Number2,
      NumberIsNaN,
      Promise: Promise2,
      PromiseReject,
      PromiseResolve,
      PromisePrototypeThen,
      Symbol: Symbol2
    } = require_primordials(), kEmpty = Symbol2("kEmpty"), kEof = Symbol2("kEof");
    function compose(stream, options) {
      if (options != null && validateObject(options, "options"), options?.signal != null && validateAbortSignal(options.signal, "options.signal"), isNodeStream(stream) && !isWritable(stream))
        throw new ERR_INVALID_ARG_VALUE("stream", stream, "must be writable");
      let composedStream = staticCompose(this, stream);
      return options != null && options.signal && addAbortSignalNoValidate(options.signal, composedStream), composedStream;
    }
    function map(fn, options) {
      if (typeof fn != "function")
        throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "AsyncFunction"], fn);
      options != null && validateObject(options, "options"), options?.signal != null && validateAbortSignal(options.signal, "options.signal");
      let concurrency = 1;
      options?.concurrency != null && (concurrency = MathFloor(options.concurrency));
      let highWaterMark = concurrency - 1;
      return options?.highWaterMark != null && (highWaterMark = MathFloor(options.highWaterMark)), validateInteger(concurrency, "options.concurrency", 1), validateInteger(highWaterMark, "options.highWaterMark", 0), highWaterMark += concurrency, async function* () {
        let signal = require_util().AbortSignalAny(
          [options?.signal].filter(Boolean2)
        ), stream = this, queue = [], signalOpt = {
          signal
        }, next, resume, done = !1, cnt = 0;
        function onCatch() {
          done = !0, afterItemProcessed();
        }
        function afterItemProcessed() {
          cnt -= 1, maybeResume();
        }
        function maybeResume() {
          resume && !done && cnt < concurrency && queue.length < highWaterMark && (resume(), resume = null);
        }
        async function pump() {
          try {
            for await (let val of stream) {
              if (done)
                return;
              if (signal.aborted)
                throw new AbortError();
              try {
                if (val = fn(val, signalOpt), val === kEmpty)
                  continue;
                val = PromiseResolve(val);
              } catch (err) {
                val = PromiseReject(err);
              }
              cnt += 1, PromisePrototypeThen(val, afterItemProcessed, onCatch), queue.push(val), next && (next(), next = null), !done && (queue.length >= highWaterMark || cnt >= concurrency) && await new Promise2((resolve2) => {
                resume = resolve2;
              });
            }
            queue.push(kEof);
          } catch (err) {
            let val = PromiseReject(err);
            PromisePrototypeThen(val, afterItemProcessed, onCatch), queue.push(val);
          } finally {
            done = !0, next && (next(), next = null);
          }
        }
        pump();
        try {
          for (; ; ) {
            for (; queue.length > 0; ) {
              let val = await queue[0];
              if (val === kEof)
                return;
              if (signal.aborted)
                throw new AbortError();
              val !== kEmpty && (yield val), queue.shift(), maybeResume();
            }
            await new Promise2((resolve2) => {
              next = resolve2;
            });
          }
        } finally {
          done = !0, resume && (resume(), resume = null);
        }
      }.call(this);
    }
    function asIndexedPairs(options = void 0) {
      return options != null && validateObject(options, "options"), options?.signal != null && validateAbortSignal(options.signal, "options.signal"), async function* () {
        let index = 0;
        for await (let val of this) {
          var _options$signal;
          if (options != null && (_options$signal = options.signal) !== null && _options$signal !== void 0 && _options$signal.aborted)
            throw new AbortError({
              cause: options.signal.reason
            });
          yield [index++, val];
        }
      }.call(this);
    }
    async function some(fn, options = void 0) {
      for await (let unused of filter.call(this, fn, options))
        return !0;
      return !1;
    }
    async function every(fn, options = void 0) {
      if (typeof fn != "function")
        throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "AsyncFunction"], fn);
      return !await some.call(
        this,
        async (...args) => !await fn(...args),
        options
      );
    }
    async function find(fn, options) {
      for await (let result of filter.call(this, fn, options))
        return result;
    }
    async function forEach(fn, options) {
      if (typeof fn != "function")
        throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "AsyncFunction"], fn);
      async function forEachFn(value, options2) {
        return await fn(value, options2), kEmpty;
      }
      for await (let unused of map.call(this, forEachFn, options)) ;
    }
    function filter(fn, options) {
      if (typeof fn != "function")
        throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "AsyncFunction"], fn);
      async function filterFn(value, options2) {
        return await fn(value, options2) ? value : kEmpty;
      }
      return map.call(this, filterFn, options);
    }
    var ReduceAwareErrMissingArgs = class extends ERR_MISSING_ARGS {
      constructor() {
        super("reduce"), this.message = "Reduce of an empty stream requires an initial value";
      }
    };
    async function reduce(reducer, initialValue, options) {
      var _options$signal2;
      if (typeof reducer != "function")
        throw new ERR_INVALID_ARG_TYPE("reducer", ["Function", "AsyncFunction"], reducer);
      options != null && validateObject(options, "options"), options?.signal != null && validateAbortSignal(options.signal, "options.signal");
      let hasInitialValue = arguments.length > 1;
      if (options != null && (_options$signal2 = options.signal) !== null && _options$signal2 !== void 0 && _options$signal2.aborted) {
        let err = new AbortError(void 0, {
          cause: options.signal.reason
        });
        throw this.once("error", () => {
        }), await finished(this.destroy(err)), err;
      }
      let ac = new AbortController2(), signal = ac.signal;
      if (options != null && options.signal) {
        let opts = {
          once: !0,
          [kWeakHandler]: this,
          [kResistStopPropagation]: !0
        };
        options.signal.addEventListener("abort", () => ac.abort(), opts);
      }
      let gotAnyItemFromStream = !1;
      try {
        for await (let value of this) {
          var _options$signal3;
          if (gotAnyItemFromStream = !0, options != null && (_options$signal3 = options.signal) !== null && _options$signal3 !== void 0 && _options$signal3.aborted)
            throw new AbortError();
          hasInitialValue ? initialValue = await reducer(initialValue, value, {
            signal
          }) : (initialValue = value, hasInitialValue = !0);
        }
        if (!gotAnyItemFromStream && !hasInitialValue)
          throw new ReduceAwareErrMissingArgs();
      } finally {
        ac.abort();
      }
      return initialValue;
    }
    async function toArray(options) {
      options != null && validateObject(options, "options"), options?.signal != null && validateAbortSignal(options.signal, "options.signal");
      let result = [];
      for await (let val of this) {
        var _options$signal4;
        if (options != null && (_options$signal4 = options.signal) !== null && _options$signal4 !== void 0 && _options$signal4.aborted)
          throw new AbortError(void 0, {
            cause: options.signal.reason
          });
        ArrayPrototypePush(result, val);
      }
      return result;
    }
    function flatMap(fn, options) {
      let values = map.call(this, fn, options);
      return async function* () {
        for await (let val of values)
          yield* val;
      }.call(this);
    }
    function toIntegerOrInfinity(number) {
      if (number = Number2(number), NumberIsNaN(number))
        return 0;
      if (number < 0)
        throw new ERR_OUT_OF_RANGE("number", ">= 0", number);
      return number;
    }
    function drop(number, options = void 0) {
      return options != null && validateObject(options, "options"), options?.signal != null && validateAbortSignal(options.signal, "options.signal"), number = toIntegerOrInfinity(number), async function* () {
        var _options$signal5;
        if (options != null && (_options$signal5 = options.signal) !== null && _options$signal5 !== void 0 && _options$signal5.aborted)
          throw new AbortError();
        for await (let val of this) {
          var _options$signal6;
          if (options != null && (_options$signal6 = options.signal) !== null && _options$signal6 !== void 0 && _options$signal6.aborted)
            throw new AbortError();
          number-- <= 0 && (yield val);
        }
      }.call(this);
    }
    function take(number, options = void 0) {
      return options != null && validateObject(options, "options"), options?.signal != null && validateAbortSignal(options.signal, "options.signal"), number = toIntegerOrInfinity(number), async function* () {
        var _options$signal7;
        if (options != null && (_options$signal7 = options.signal) !== null && _options$signal7 !== void 0 && _options$signal7.aborted)
          throw new AbortError();
        for await (let val of this) {
          var _options$signal8;
          if (options != null && (_options$signal8 = options.signal) !== null && _options$signal8 !== void 0 && _options$signal8.aborted)
            throw new AbortError();
          if (number-- > 0 && (yield val), number <= 0)
            return;
        }
      }.call(this);
    }
    module.exports.streamReturningOperators = {
      asIndexedPairs: deprecate2(asIndexedPairs, "readable.asIndexedPairs will be removed in a future version."),
      drop,
      filter,
      flatMap,
      map,
      take,
      compose
    };
    module.exports.promiseReturningOperators = {
      every,
      forEach,
      reduce,
      toArray,
      some,
      find
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/stream/promises.js
var require_promises = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/stream/promises.js"(exports, module) {
    "use strict";
    var { ArrayPrototypePop, Promise: Promise2 } = require_primordials(), { isIterable, isNodeStream, isWebStream } = require_utils(), { pipelineImpl: pl } = require_pipeline(), { finished } = require_end_of_stream();
    require_stream();
    function pipeline(...streams) {
      return new Promise2((resolve2, reject) => {
        let signal, end, lastArg = streams[streams.length - 1];
        if (lastArg && typeof lastArg == "object" && !isNodeStream(lastArg) && !isIterable(lastArg) && !isWebStream(lastArg)) {
          let options = ArrayPrototypePop(streams);
          signal = options.signal, end = options.end;
        }
        pl(
          streams,
          (err, value) => {
            err ? reject(err) : resolve2(value);
          },
          {
            signal,
            end
          }
        );
      });
    }
    module.exports = {
      finished,
      pipeline
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/stream.js
var require_stream = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/stream.js"(exports, module) {
    "use strict";
    var { Buffer: Buffer6 } = require_buffer(), { ObjectDefineProperty, ObjectKeys, ReflectApply } = require_primordials(), {
      promisify: { custom: customPromisify }
    } = require_util(), { streamReturningOperators, promiseReturningOperators } = require_operators(), {
      codes: { ERR_ILLEGAL_CONSTRUCTOR }
    } = require_errors(), compose = require_compose(), { setDefaultHighWaterMark, getDefaultHighWaterMark } = require_state(), { pipeline } = require_pipeline(), { destroyer } = require_destroy(), eos = require_end_of_stream(), promises3 = require_promises(), utils = require_utils(), Stream = module.exports = require_legacy().Stream;
    Stream.isDestroyed = utils.isDestroyed;
    Stream.isDisturbed = utils.isDisturbed;
    Stream.isErrored = utils.isErrored;
    Stream.isReadable = utils.isReadable;
    Stream.isWritable = utils.isWritable;
    Stream.Readable = require_readable();
    for (let key of ObjectKeys(streamReturningOperators)) {
      let fn = function(...args) {
        if (new.target)
          throw ERR_ILLEGAL_CONSTRUCTOR();
        return Stream.Readable.from(ReflectApply(op, this, args));
      }, op = streamReturningOperators[key];
      ObjectDefineProperty(fn, "name", {
        __proto__: null,
        value: op.name
      }), ObjectDefineProperty(fn, "length", {
        __proto__: null,
        value: op.length
      }), ObjectDefineProperty(Stream.Readable.prototype, key, {
        __proto__: null,
        value: fn,
        enumerable: !1,
        configurable: !0,
        writable: !0
      });
    }
    for (let key of ObjectKeys(promiseReturningOperators)) {
      let fn = function(...args) {
        if (new.target)
          throw ERR_ILLEGAL_CONSTRUCTOR();
        return ReflectApply(op, this, args);
      }, op = promiseReturningOperators[key];
      ObjectDefineProperty(fn, "name", {
        __proto__: null,
        value: op.name
      }), ObjectDefineProperty(fn, "length", {
        __proto__: null,
        value: op.length
      }), ObjectDefineProperty(Stream.Readable.prototype, key, {
        __proto__: null,
        value: fn,
        enumerable: !1,
        configurable: !0,
        writable: !0
      });
    }
    Stream.Writable = require_writable();
    Stream.Duplex = require_duplex();
    Stream.Transform = require_transform();
    Stream.PassThrough = require_passthrough();
    Stream.pipeline = pipeline;
    var { addAbortSignal } = require_add_abort_signal();
    Stream.addAbortSignal = addAbortSignal;
    Stream.finished = eos;
    Stream.destroy = destroyer;
    Stream.compose = compose;
    Stream.setDefaultHighWaterMark = setDefaultHighWaterMark;
    Stream.getDefaultHighWaterMark = getDefaultHighWaterMark;
    ObjectDefineProperty(Stream, "promises", {
      __proto__: null,
      configurable: !0,
      enumerable: !0,
      get() {
        return promises3;
      }
    });
    ObjectDefineProperty(pipeline, customPromisify, {
      __proto__: null,
      enumerable: !0,
      get() {
        return promises3.pipeline;
      }
    });
    ObjectDefineProperty(eos, customPromisify, {
      __proto__: null,
      enumerable: !0,
      get() {
        return promises3.finished;
      }
    });
    Stream.Stream = Stream;
    Stream._isUint8Array = function(value) {
      return value instanceof Uint8Array;
    };
    Stream._uint8ArrayToBuffer = function(chunk) {
      return Buffer6.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    };
  }
});

// node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/ours/browser.js
var require_browser = __commonJS({
  "node_modules/.pnpm/readable-stream@4.7.0/node_modules/readable-stream/lib/ours/browser.js"(exports, module) {
    "use strict";
    var CustomStream = require_stream(), promises3 = require_promises(), originalDestroy = CustomStream.Readable.destroy;
    module.exports = CustomStream.Readable;
    module.exports._uint8ArrayToBuffer = CustomStream._uint8ArrayToBuffer;
    module.exports._isUint8Array = CustomStream._isUint8Array;
    module.exports.isDisturbed = CustomStream.isDisturbed;
    module.exports.isErrored = CustomStream.isErrored;
    module.exports.isReadable = CustomStream.isReadable;
    module.exports.Readable = CustomStream.Readable;
    module.exports.Writable = CustomStream.Writable;
    module.exports.Duplex = CustomStream.Duplex;
    module.exports.Transform = CustomStream.Transform;
    module.exports.PassThrough = CustomStream.PassThrough;
    module.exports.addAbortSignal = CustomStream.addAbortSignal;
    module.exports.finished = CustomStream.finished;
    module.exports.destroy = CustomStream.destroy;
    module.exports.destroy = originalDestroy;
    module.exports.pipeline = CustomStream.pipeline;
    module.exports.compose = CustomStream.compose;
    Object.defineProperty(CustomStream, "promises", {
      configurable: !0,
      enumerable: !0,
      get() {
        return promises3;
      }
    });
    module.exports.Stream = CustomStream.Stream;
    module.exports.default = module.exports;
  }
});

// src/node/worker.ts
var import_buffer4 = __toESM(require_buffer(), 1), import_events5 = __toESM(require_events(), 1), streamMod = __toESM(require_browser(), 1), import_string_decoder = __toESM(require_string_decoder(), 1);

// src/path.ts
function normalizeParts(parts, allowAboveRoot) {
  let out = [];
  for (let p of parts)
    !p || p === "." || (p === ".." ? out.length && out[out.length - 1] !== ".." ? out.pop() : allowAboveRoot && out.push("..") : out.push(p));
  return out;
}
function isAbsolute(p) {
  return p.startsWith("/");
}
function normalize(p) {
  if (!p) return ".";
  let abs = isAbsolute(p), trailing = p.endsWith("/"), res = normalizeParts(p.split("/"), !abs).join("/");
  return !res && !abs && (res = "."), res && trailing && (res += "/"), (abs ? "/" : "") + res;
}
function join(...parts) {
  let joined = parts.filter((p) => p).join("/");
  return joined ? normalize(joined) : ".";
}
var cwdFn = () => "/";
function setCwd(fn) {
  cwdFn = fn;
}
function resolve(...parts) {
  let res = "";
  for (let i = parts.length - 1; i >= 0 && !isAbsolute(res); i--) {
    let p = parts[i];
    p && (res = res ? `${p}/${res}` : p);
  }
  return isAbsolute(res) || (res = `${cwdFn()}/${res}`), "/" + normalizeParts(res.split("/"), !1).join("/");
}
function dirname(p) {
  if (!p) return ".";
  let s2 = p.replace(/\/+$/, "");
  if (!s2) return "/";
  let i = s2.lastIndexOf("/");
  return i < 0 ? "." : i === 0 ? "/" : s2.slice(0, i);
}
function basename(p, ext) {
  let s2 = p.replace(/\/+$/, ""), b = s2.slice(s2.lastIndexOf("/") + 1);
  return ext && b.endsWith(ext) && b !== ext && (b = b.slice(0, -ext.length)), b;
}
function extname(p) {
  let b = basename(p), i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i);
}
function relative(from, to) {
  let f = resolve(from).split("/").filter(Boolean), t = resolve(to).split("/").filter(Boolean), i = 0;
  for (; i < f.length && i < t.length && f[i] === t[i]; ) i++;
  return [...Array(f.length - i).fill(".."), ...t.slice(i)].join("/");
}
function parse(p) {
  let root = isAbsolute(p) ? "/" : "", base = basename(p), ext = extname(p), d = dirname(p);
  return { root, dir: d === "." && !p.includes("/") ? "" : d, base, ext, name: ext ? base.slice(0, -ext.length) : base };
}
function format(o) {
  let dir = o.dir || o.root || "", base = o.base || (o.name || "") + (o.ext || "");
  return dir ? dir === o.root ? dir + base : `${dir}/${base}` : base;
}
function toNamespacedPath(p) {
  return p;
}
var path = {
  sep: "/",
  delimiter: ":",
  isAbsolute,
  normalize,
  join,
  resolve,
  dirname,
  basename,
  extname,
  relative,
  parse,
  format,
  toNamespacedPath,
  posix: void 0,
  win32: void 0
};
path.posix = path;
path.win32 = path;
var path_default = path;

// src/node/protocol.ts
var enc = new TextEncoder(), dec = new TextDecoder();
function decodeResult(bytes) {
  let tag2 = bytes[0], body = bytes.subarray(1);
  if (tag2 === 3) return;
  if (tag2 === 1) return body.slice();
  let v = JSON.parse(dec.decode(body));
  if (tag2 === 2) {
    let e = new Error(v.message);
    throw v.code && (e.code = v.code), v.path && (e.path = v.path), e;
  }
  return v;
}

// src/node/rpc.ts
var sab = null;
function setSab(s2) {
  sab = s2;
}
var hasSync = () => sab !== null;
function post(m, transfer = []) {
  self.postMessage(m, transfer);
}
function syncCall(op, ...args) {
  if (!sab)
    throw Object.assign(new Error(`[clover] synchronous '${op}' requires a cross-origin isolated page (COOP/COEP headers); use fs.promises instead`), {
      code: "ERR_CLOVER_NO_SYNC"
    });
  let i32 = new Int32Array(sab, 0, 2);
  if (Atomics.store(i32, 0, 0), post({ type: "sync", op, args }), Atomics.wait(i32, 0, 0), Atomics.load(i32, 0) === 2) {
    let len2 = Atomics.load(i32, 1);
    sab = new SharedArrayBuffer(8 + len2 + 1024 * 1024), i32 = new Int32Array(sab, 0, 2), Atomics.store(i32, 0, 0), post({ type: "sync-grow", sab }), Atomics.wait(i32, 0, 0);
  }
  let len = Atomics.load(i32, 1);
  return decodeResult(new Uint8Array(sab, 8, len).slice());
}
var asyncId = 0, waiting = /* @__PURE__ */ new Map();
function asyncCall(op, ...args) {
  let id = ++asyncId, release = ref();
  return new Promise((resolve2, reject) => {
    waiting.set(id, { resolve: resolve2, reject }), post({ type: "async", id, op, args });
  }).finally(release);
}
function handleAsyncResult(m) {
  let w = waiting.get(m.id);
  if (w)
    if (waiting.delete(m.id), m.ok) w.resolve(m.value);
    else {
      let v = m.value;
      w.reject(Object.assign(new Error(v.message), v.code ? { code: v.code } : {}));
    }
}
var refs = 0, onIdle = null, checkScheduled = !1, nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
function ref() {
  refs++;
  let released = !1;
  return () => {
    released || (released = !0, refs--, scheduleIdleCheck());
  };
}
var activeRefs = () => refs;
function setIdleHandler(fn) {
  onIdle = fn;
}
function scheduleIdleCheck() {
  checkScheduled || (checkScheduled = !0, nativeSetTimeout(() => {
    checkScheduled = !1, refs <= 0 && onIdle?.();
  }, 0));
}

// src/node/modules/process.ts
var import_events = __toESM(require_events(), 1);
var Stdin = class extends import_events.EventEmitter {
  isTTY = !1;
  fd = 0;
  readable = !0;
  buffered = [];
  ended = !1;
  flowing = !1;
  encoding = null;
  setEncoding(e) {
    return this.encoding = e, this;
  }
  setRawMode() {
    return this;
  }
  resume() {
    return this.flowing = !0, this.flush(), this;
  }
  pause() {
    return this.flowing = !1, this;
  }
  ref() {
    return this;
  }
  unref() {
    return this;
  }
  on(ev, fn) {
    return super.on(ev, fn), (ev === "data" || ev === "readable") && this.resume(), this;
  }
  read() {
    return this.buffered.length ? this.buffered.splice(0).join("") : null;
  }
  push(s2) {
    this.buffered.push(s2), this.flush();
  }
  end() {
    this.ended = !0, this.flush();
  }
  flush() {
    if (!this.flowing) {
      this.buffered.length && this.emit("readable");
      return;
    }
    for (; this.buffered.length; ) {
      let s2 = this.buffered.shift();
      this.emit("data", this.encoding ? s2 : globalThis.Buffer ? globalThis.Buffer.from(s2) : s2);
    }
    this.ended && (this.ended = !1, this.readable = !1, this.emit("end"), this.emit("close"));
  }
  pipe(dest) {
    return this.on("data", (c) => dest.write(c)), this.on("end", () => dest.end?.()), dest;
  }
  async *[Symbol.asyncIterator]() {
    let q = [], done = !1, wake = null;
    for (this.on("data", (c) => (q.push(c), wake?.())), this.on("end", () => (done = !0, wake?.())); ; )
      if (q.length) yield q.shift();
      else {
        if (done) return;
        await new Promise((r) => wake = r);
      }
  }
}, Stdout = class extends import_events.EventEmitter {
  constructor(kind, isTTY, fd) {
    super();
    this.kind = kind;
    this.isTTY = isTTY;
    this.fd = fd;
  }
  kind;
  isTTY;
  fd;
  writable = !0;
  columns = 80;
  rows = 24;
  write(chunk, enc2, cb) {
    let s2 = typeof chunk == "string" ? chunk : chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : String(chunk);
    post({ type: this.kind, data: s2 });
    let done = typeof enc2 == "function" ? enc2 : cb;
    return typeof done == "function" && queueMicrotask(() => done()), !0;
  }
  end(chunk) {
    return chunk && this.write(chunk), this;
  }
  getColorDepth() {
    return this.isTTY ? 8 : 1;
  }
  hasColors() {
    return this.isTTY;
  }
  getWindowSize() {
    return [this.columns, this.rows];
  }
  cursorTo(x, _y, cb) {
    return this.write(`\x1B[${x + 1}G`), cb?.(), !0;
  }
  moveCursor(dx, dy, cb) {
    return dx && this.write(dx > 0 ? `\x1B[${dx}C` : `\x1B[${-dx}D`), dy && this.write(dy > 0 ? `\x1B[${dy}B` : `\x1B[${-dy}A`), cb?.(), !0;
  }
  clearLine(_dir, cb) {
    return this.write("\x1B[2K"), cb?.(), !0;
  }
  clearScreenDown(cb) {
    return this.write("\x1B[J"), cb?.(), !0;
  }
}, ExitSignal = class {
  constructor(code) {
    this.code = code;
  }
  code;
}, t0 = performance.now();
function createProcess(opts) {
  let cwd = opts.cwd, proc2 = new import_events.EventEmitter(), stdout = new Stdout("stdout", opts.isTTY, 1), stderr = new Stdout("stderr", opts.isTTY, 2);
  stdout.columns = stderr.columns = opts.columns;
  let stdin = new Stdin();
  stdin.isTTY = opts.isTTY;
  let hrtime = (prev) => {
    let t = performance.now() * 1e6, s2 = Math.floor(t / 1e9), ns = Math.floor(t % 1e9);
    return prev && (s2 -= prev[0], ns -= prev[1], ns < 0 && (s2--, ns += 1e9)), [s2, ns];
  };
  return hrtime.bigint = () => BigInt(Math.floor(performance.now() * 1e6)), Object.assign(proc2, {
    title: "node",
    version: "v22.12.0",
    versions: { node: "22.12.0", v8: "12.4.254", uv: "1.49.0", modules: "127" },
    arch: "x64",
    platform: "linux",
    release: { name: "node" },
    argv: opts.argv,
    argv0: "node",
    execArgv: [],
    execPath: "/usr/local/bin/node",
    env: opts.env,
    pid: opts.pid,
    ppid: 1,
    exitCode: void 0,
    stdout,
    stderr,
    stdin,
    browser: !1,
    features: {},
    config: { variables: {} },
    cwd: () => cwd,
    chdir: (d) => {
      cwd = d.startsWith("/") ? d : `${cwd}/${d}`;
    },
    umask: () => 18,
    getuid: () => 1e3,
    getgid: () => 1e3,
    geteuid: () => 1e3,
    getegid: () => 1e3,
    exit: (code) => opts.exit(code ?? proc2.exitCode ?? 0),
    abort: () => opts.exit(134),
    kill: () => !0,
    nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
    hrtime,
    uptime: () => (performance.now() - t0) / 1e3,
    memoryUsage: Object.assign(() => ({ rss: 5e7, heapTotal: 3e7, heapUsed: 2e7, external: 1e6, arrayBuffers: 1e5 }), { rss: () => 5e7 }),
    cpuUsage: () => ({ user: 0, system: 0 }),
    resourceUsage: () => ({}),
    emitWarning: (w) => {
      let msg = w instanceof Error ? w.message : String(w);
      stderr.write(`(node) Warning: ${msg}
`);
    },
    binding: () => {
      throw new Error("process.binding is not supported");
    },
    setUncaughtExceptionCaptureCallback: () => {
    },
    hasUncaughtExceptionCaptureCallback: () => !1,
    getActiveResourcesInfo: () => []
  }), setCwd(() => cwd), proc2;
}

// src/node/modules/fs.ts
var import_buffer = __toESM(require_buffer(), 1), import_events2 = __toESM(require_events(), 1), import_readable_stream = __toESM(require_browser(), 1);
var Stats = class {
  constructor(raw) {
    this.raw = raw;
    this.size = raw.size, this.mode = raw.mode, this.blocks = Math.ceil(raw.size / 512), this.atimeMs = this.mtimeMs = raw.mtimeMs, this.ctimeMs = this.birthtimeMs = raw.ctimeMs, this.atime = this.mtime = new Date(raw.mtimeMs), this.ctime = this.birthtime = new Date(raw.ctimeMs);
  }
  raw;
  dev = 1;
  ino = 0;
  nlink = 1;
  uid = 1e3;
  gid = 1e3;
  rdev = 0;
  blksize = 4096;
  blocks;
  size;
  mode;
  atimeMs;
  mtimeMs;
  ctimeMs;
  birthtimeMs;
  atime;
  mtime;
  ctime;
  birthtime;
  isFile() {
    return this.raw.type === "file";
  }
  isDirectory() {
    return this.raw.type === "dir";
  }
  isSymbolicLink() {
    return this.raw.type === "symlink";
  }
  isFIFO() {
    return !1;
  }
  isSocket() {
    return !1;
  }
  isBlockDevice() {
    return !1;
  }
  isCharacterDevice() {
    return !1;
  }
}, Dirent = class {
  constructor(name, type, parentPath = "") {
    this.name = name;
    this.type = type;
    this.parentPath = parentPath;
  }
  name;
  type;
  parentPath;
  get path() {
    return this.parentPath;
  }
  isFile() {
    return this.type === "file";
  }
  isDirectory() {
    return this.type === "dir";
  }
  isSymbolicLink() {
    return this.type === "symlink";
  }
  isFIFO() {
    return !1;
  }
  isSocket() {
    return !1;
  }
  isBlockDevice() {
    return !1;
  }
  isCharacterDevice() {
    return !1;
  }
}, P = (p) => p instanceof URL ? decodeURIComponent(p.pathname) : (typeof p != "string" && (p = String(p)), p.startsWith("file://") && (p = decodeURIComponent(new URL(p).pathname)), resolve(p)), encOf = (o) => typeof o == "string" ? o : o?.encoding ?? null;
function decode(bytes, enc2) {
  let b = import_buffer.Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return enc2 ? b.toString(enc2) : b;
}
function toData(d, enc2) {
  return typeof d == "string" ? enc2 && enc2 !== "utf8" && enc2 !== "utf-8" ? new Uint8Array(import_buffer.Buffer.from(d, enc2)) : d : d instanceof Uint8Array ? d : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : String(d);
}
var fixErr = (e) => {
  let err = e;
  throw err.code && !err.errno && (err.errno = -2), err;
};
function wrapSync(fn) {
  return (...a2) => {
    try {
      return fn(...a2);
    } catch (e) {
      return fixErr(e);
    }
  };
}
var s = {
  readFileSync: (p, o) => {
    if (typeof p == "number") throw new Error("readFileSync(fd) not supported");
    return decode(syncCall("readFile", P(p)), encOf(o));
  },
  writeFileSync: (p, d, o) => syncCall("writeFile", P(p), toData(d, encOf(o)), typeof o == "object" && o?.flag?.startsWith("a") ? "a" : "w"),
  appendFileSync: (p, d, o) => syncCall("writeFile", P(p), toData(d, encOf(o)), "a"),
  existsSync: (p) => {
    try {
      return syncCall("exists", P(p));
    } catch {
      return !1;
    }
  },
  statSync: (p, o) => {
    try {
      return new Stats(syncCall("stat", P(p)));
    } catch (e) {
      if (o?.throwIfNoEntry === !1 && e.code === "ENOENT") return;
      throw e;
    }
  },
  lstatSync: (p, o) => {
    try {
      return new Stats(syncCall("lstat", P(p)));
    } catch (e) {
      if (o?.throwIfNoEntry === !1 && e.code === "ENOENT") return;
      throw e;
    }
  },
  readdirSync: (p, o) => {
    let dir = P(p), ents = syncCall("readdir", dir), withTypes = typeof o == "object" && o?.withFileTypes;
    if (typeof o == "object" && o?.recursive) {
      let out = [], walk = (d, rel, list) => {
        for (let e of list) {
          let r = rel ? `${rel}/${e.name}` : e.name;
          out.push(withTypes ? new Dirent(e.name, e.type, d) : r), e.type === "dir" && walk(`${d}/${e.name}`, r, syncCall("readdir", `${d}/${e.name}`));
        }
      };
      return walk(dir, "", ents), out;
    }
    return withTypes ? ents.map((e) => new Dirent(e.name, e.type, dir)) : ents.map((e) => e.name);
  },
  mkdirSync: (p, o) => syncCall("mkdir", P(p), typeof o == "object" && o?.recursive),
  rmSync: (p, o) => syncCall("rm", P(p), o?.recursive, o?.force),
  rmdirSync: (p, o) => o?.recursive ? syncCall("rm", P(p), !0, !0) : syncCall("rmdir", P(p)),
  unlinkSync: (p) => syncCall("unlink", P(p)),
  renameSync: (a2, b) => syncCall("rename", P(a2), P(b)),
  copyFileSync: (a2, b) => syncCall("copyFile", P(a2), P(b)),
  cpSync: (a2, b) => syncCall("cp", P(a2), P(b)),
  realpathSync: Object.assign((p) => syncCall("realpath", P(p)), { native: (p) => syncCall("realpath", P(p)) }),
  readlinkSync: (p) => syncCall("readlink", P(p)),
  symlinkSync: (t, p) => syncCall("symlink", String(t), P(p)),
  accessSync: (p) => {
    if (!syncCall("exists", P(p))) throw Object.assign(new Error(`ENOENT: no such file or directory, access '${p}'`), { code: "ENOENT", errno: -2, syscall: "access", path: String(p) });
  },
  utimesSync: (p, _a, m) => syncCall("utimes", P(p), m instanceof Date ? m.getTime() : Number(m) * 1e3),
  chmodSync: () => {
  },
  chownSync: () => {
  },
  fsyncSync: () => {
  },
  mkdtempSync: (prefix) => {
    let p = prefix + Math.random().toString(36).slice(2, 8);
    return syncCall("mkdir", P(p), !0), p;
  }
};
for (let k of Object.keys(s)) s[k] = wrapSync(s[k]);
var fds = /* @__PURE__ */ new Map(), nextFd = 10, fdApi = {
  openSync: (p, flags = "r") => {
    let f = typeof flags == "number" ? flags & 1 || flags & 2 ? "w" : "r" : flags, path2 = P(p);
    if (f.startsWith("w")) syncCall("writeFile", path2, "", "w");
    else if (f.startsWith("a") && !syncCall("exists", path2)) syncCall("writeFile", path2, "", "w");
    else if (!syncCall("exists", path2)) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path2}'`), { code: "ENOENT", errno: -2 });
    let fd = nextFd++;
    return fds.set(fd, { path: path2, flags: f, pos: 0, data: null }), fd;
  },
  closeSync: (fd) => {
    fds.delete(fd);
  },
  writeSync: (fd, d, ...rest) => {
    if (fd === 1 || fd === 2)
      return (fd === 1 ? globalThis.process.stdout : globalThis.process.stderr).write(d), typeof d == "string" ? d.length : d.byteLength;
    let h = fds.get(fd);
    if (!h) throw Object.assign(new Error("EBADF: bad file descriptor"), { code: "EBADF" });
    let bytes = typeof d == "string" ? new TextEncoder().encode(d) : d;
    return typeof rest[0] == "number" && typeof d != "string" && (bytes = bytes.subarray(rest[0], rest[0] + (rest[1] ?? bytes.length))), syncCall("writeFile", h.path, bytes, "a"), bytes.byteLength;
  },
  readSync: (fd, buf, off = 0, len = buf.byteLength - off, pos = null) => {
    let h = fds.get(fd);
    if (!h) throw Object.assign(new Error("EBADF: bad file descriptor"), { code: "EBADF" });
    h.data ??= syncCall("readFile", h.path);
    let start2 = pos ?? h.pos, chunk = h.data.subarray(start2, start2 + len);
    return buf.set(chunk, off), pos === null && (h.pos += chunk.byteLength), chunk.byteLength;
  },
  fstatSync: (fd) => fd <= 2 ? new Stats({ type: "file", size: 0, mtimeMs: Date.now(), ctimeMs: Date.now(), mode: 8630 }) : s.statSync(fds.get(fd).path),
  ftruncateSync: () => {
  }
}, a = (op, ...args) => asyncCall(op, ...args), promises = {
  readFile: async (p, o) => decode(await a("readFile", P(p)), encOf(o)),
  writeFile: (p, d, o) => a("writeFile", P(p), toData(d, encOf(o)), typeof o == "object" && o?.flag?.startsWith("a") ? "a" : "w"),
  appendFile: (p, d, o) => a("writeFile", P(p), toData(d, encOf(o)), "a"),
  stat: async (p) => new Stats(await a("stat", P(p))),
  lstat: async (p) => new Stats(await a("lstat", P(p))),
  readdir: async (p, o) => {
    let ents = await a("readdir", P(p));
    return typeof o == "object" && o?.withFileTypes ? ents.map((e) => new Dirent(e.name, e.type, P(p))) : ents.map((e) => e.name);
  },
  mkdir: (p, o) => a("mkdir", P(p), o?.recursive),
  rm: (p, o) => a("rm", P(p), o?.recursive, o?.force),
  rmdir: (p, o) => o?.recursive ? a("rm", P(p), !0, !0) : a("rmdir", P(p)),
  unlink: (p) => a("unlink", P(p)),
  rename: (x, y) => a("rename", P(x), P(y)),
  copyFile: (x, y) => a("copyFile", P(x), P(y)),
  cp: (x, y) => a("cp", P(x), P(y)),
  realpath: (p) => a("realpath", P(p)),
  readlink: (p) => a("readlink", P(p)),
  symlink: (t, p) => a("symlink", String(t), P(p)),
  access: async (p) => {
    if (!await a("exists", P(p))) throw Object.assign(new Error(`ENOENT: no such file or directory, access '${p}'`), { code: "ENOENT", errno: -2, path: String(p) });
  },
  utimes: (p, _a, m) => a("utimes", P(p), m instanceof Date ? m.getTime() : Number(m) * 1e3),
  chmod: async () => {
  },
  chown: async () => {
  },
  mkdtemp: async (prefix) => {
    let p = prefix + Math.random().toString(36).slice(2, 8);
    return await a("mkdir", P(p), !0), p;
  },
  open: async (p, flags = "r") => {
    let fd = fdApi.openSync(p, flags);
    return {
      fd,
      readFile: (o) => promises.readFile(p, o),
      writeFile: (d) => promises.writeFile(p, d),
      write: async (d) => ({ bytesWritten: fdApi.writeSync(fd, d) }),
      stat: () => promises.stat(p),
      close: async () => fdApi.closeSync(fd),
      [Symbol.asyncDispose]: async () => fdApi.closeSync(fd)
    };
  },
  constants: {}
};
function callbackify(fn) {
  return (...args) => {
    let cb = typeof args[args.length - 1] == "function" ? args.pop() : null, release = ref();
    fn(...args).then(
      (v) => (release(), cb?.(null, v)),
      (e) => (release(), cb?.(e))
    );
  };
}
var cbApi = {};
for (let [k, fn] of Object.entries(promises)) typeof fn == "function" && (cbApi[k] = callbackify(fn));
cbApi.exists = (p, cb) => {
  let release = ref();
  a("exists", P(p)).then(
    (v) => (release(), cb(v)),
    () => (release(), cb(!1))
  );
};
for (let k of ["open", "close", "read", "write", "fstat"]) {
  let sync = fdApi[k + "Sync"];
  cbApi[k] = (...args) => {
    let cb = args.pop();
    try {
      let r = sync(...args);
      queueMicrotask(() => cb(null, r));
    } catch (e) {
      queueMicrotask(() => cb(e));
    }
  };
}
function createReadStream(p, o) {
  let path2 = P(p), enc2 = encOf(o), opts = typeof o == "object" && o ? o : {}, loaded = !1, stream = new import_readable_stream.Readable({
    highWaterMark: opts.highWaterMark ?? 64 * 1024,
    read() {
      loaded || (loaded = !0, a("readFile", path2).then(
        (data) => {
          let slice = data.subarray(opts.start ?? 0, opts.end !== void 0 ? opts.end + 1 : void 0), CH = 64 * 1024;
          for (let i = 0; i < slice.byteLength; i += CH) {
            let c = import_buffer.Buffer.from(slice.subarray(i, i + CH));
            this.push(enc2 ? c.toString(enc2) : c);
          }
          this.push(null);
        },
        (e) => this.destroy(e)
      ));
    }
  });
  return stream.path = path2, stream.bytesRead = 0, queueMicrotask(() => stream.emit("open", 3)), stream;
}
function createWriteStream(p, o) {
  let path2 = P(p), first = !(typeof o == "object" && o?.flag?.startsWith("a")), stream = new import_readable_stream.Writable({
    write(chunk, _enc, cb) {
      let mode = first ? "w" : "a";
      first = !1, a("writeFile", path2, toData(chunk), mode).then(() => cb(), cb);
    },
    final(cb) {
      first ? a("writeFile", path2, "", "w").then(() => cb(), cb) : cb();
    }
  });
  return stream.path = path2, stream.bytesWritten = 0, queueMicrotask(() => stream.emit("open", 4)), stream;
}
function watch(_p, ..._args) {
  let w = new import_events2.EventEmitter();
  return w.close = () => {
  }, w.ref = w.unref = () => w, w;
}
var constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_EXCL: 128,
  O_TRUNC: 512,
  O_APPEND: 1024,
  S_IFMT: 61440,
  S_IFREG: 32768,
  S_IFDIR: 16384,
  S_IFLNK: 40960,
  COPYFILE_EXCL: 1
}, fs = {
  ...s,
  ...fdApi,
  ...cbApi,
  promises,
  constants,
  Stats,
  Dirent,
  createReadStream,
  createWriteStream,
  watch,
  watchFile: () => {
  },
  unwatchFile: () => {
  },
  ...constants
};
promises.constants = constants;
var fs_default = fs;

// src/node/modules/util.ts
var kCustom = /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom"), kPromisify = /* @__PURE__ */ Symbol.for("nodejs.util.promisify.custom");
function inspect(v, opts = {}) {
  let o = typeof opts == "boolean" ? { depth: 2 } : opts, seen = /* @__PURE__ */ new Set(), depth = o.depth ?? 2, fmt = (x, d, top = !1) => {
    if (x === null) return "null";
    switch (typeof x) {
      case "string":
        return top ? x : `'${x.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;
      case "number":
        return Object.is(x, -0) ? "-0" : String(x);
      case "bigint":
        return `${x}n`;
      case "undefined":
        return "undefined";
      case "boolean":
        return String(x);
      case "symbol":
        return x.toString();
      case "function": {
        let name = x.name, isClass = /^class\s/.test(Function.prototype.toString.call(x)), keys = Object.keys(x), base = isClass ? `[class ${name || "(anonymous)"}]` : `[Function: ${name || "(anonymous)"}]`;
        return keys.length && d <= depth ? `${base} ${fmtObj(x, d, keys)}` : base;
      }
    }
    let obj = x;
    if (typeof obj[kCustom] == "function") {
      let r = obj[kCustom](depth - d, o, inspect);
      return typeof r == "string" ? r : fmt(r, d);
    }
    if (seen.has(x)) return "[Circular *1]";
    if (x instanceof Error) return x.stack || `${x.name}: ${x.message}`;
    if (x instanceof Date) return isNaN(x.getTime()) ? "Invalid Date" : x.toISOString();
    if (x instanceof RegExp) return String(x);
    if (x instanceof Promise) return "Promise { <pending> }";
    if (x instanceof WeakMap) return "WeakMap { <items unknown> }";
    if (x instanceof WeakSet) return "WeakSet { <items unknown> }";
    if (typeof globalThis.Buffer < "u" && globalThis.Buffer.isBuffer(x)) {
      let b = x;
      return `<Buffer ${[...b.subarray(0, 50)].map((n) => n.toString(16).padStart(2, "0")).join(" ")}${b.length > 50 ? ` ... ${b.length - 50} more bytes` : ""}>`;
    }
    if (d > depth) return Array.isArray(x) ? "[Array]" : `[${ctorName(x) || "Object"}]`;
    seen.add(x);
    try {
      if (Array.isArray(x)) {
        let items = x.slice(0, 100).map((i) => fmt(i, d + 1));
        return x.length > 100 && items.push(`... ${x.length - 100} more items`), wrap(items, "[", "]", d);
      }
      if (ArrayBuffer.isView(x)) {
        let arr = Array.from(x).slice(0, 100).map(String);
        return `${ctorName(x)}(${x.length}) ${wrap(arr, "[", "]", d)}`;
      }
      if (x instanceof Map) return `Map(${x.size}) ${wrap([...x].map(([k, v2]) => `${fmt(k, d + 1)} => ${fmt(v2, d + 1)}`), "{", "}", d)}`;
      if (x instanceof Set) return `Set(${x.size}) ${wrap([...x].map((v2) => fmt(v2, d + 1)), "{", "}", d)}`;
      let name = ctorName(x), body = fmtObj(x, d, Object.keys(x));
      return name && name !== "Object" ? `${name} ${body}` : body;
    } finally {
      seen.delete(x);
    }
  }, fmtObj = (x, d, keys) => {
    let rec = x, items = keys.map((k) => {
      let key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`, desc = Object.getOwnPropertyDescriptor(x, k);
      return desc?.get ? `${key}: [Getter${desc.set ? "/Setter" : ""}]` : `${key}: ${fmt(rec[k], d + 1)}`;
    });
    for (let sym of Object.getOwnPropertySymbols(x)) Object.getOwnPropertyDescriptor(x, sym)?.enumerable && items.push(`[${sym.toString()}]: ${fmt(rec[sym], d + 1)}`);
    return items.length ? wrap(items, "{", "}", d) : "{}";
  }, wrap = (items, open, close, d) => {
    if (!items.length) return `${open}${close}`;
    let one = `${open} ${items.join(", ")} ${close}`;
    if (one.length <= (o.breakLength ?? 72) && !one.includes(`
`)) return one;
    let pad = "  ".repeat(d + 1);
    return `${open}
${items.map((i) => pad + i).join(`,
`)}
${"  ".repeat(d)}${close}`;
  };
  return fmt(v, 0, !1);
}
inspect.custom = kCustom;
inspect.defaultOptions = { depth: 2 };
function ctorName(x) {
  let p = Object.getPrototypeOf(x);
  return p === null ? "[Object: null prototype]" : p?.constructor?.name ?? "";
}
function format2(f, ...args) {
  if (typeof f != "string") return [f, ...args].map((a2) => typeof a2 == "string" ? a2 : inspect(a2)).join(" ");
  let i = 0, out = f.replace(/%([sdifjoOc%])/g, (m, c) => {
    if (c === "%") return "%";
    if (i >= args.length) return m;
    let a2 = args[i++];
    switch (c) {
      case "s":
        return typeof a2 == "string" ? a2 : typeof a2 == "object" && a2 !== null ? inspect(a2, { depth: 0 }) : String(a2);
      case "d":
      case "i":
        return typeof a2 == "bigint" ? `${a2}n` : String(c === "i" ? parseInt(String(a2), 10) : Number(a2));
      case "f":
        return String(parseFloat(String(a2)));
      case "j":
        try {
          return JSON.stringify(a2);
        } catch {
          return "[Circular]";
        }
      case "c":
        return "";
      default:
        return inspect(a2);
    }
  });
  for (; i < args.length; i++) out += " " + (typeof args[i] == "string" ? args[i] : inspect(args[i]));
  return out;
}
function promisify(fn) {
  let custom = fn[kPromisify];
  return typeof custom == "function" ? custom : function(...args) {
    return new Promise((res, rej) => fn.call(this, ...args, (e, v) => e ? rej(e) : res(v)));
  };
}
promisify.custom = kPromisify;
function callbackify2(fn) {
  return (...args) => {
    let cb = args.pop();
    fn(...args).then(
      (v) => cb(null, v),
      (e) => cb(e)
    );
  };
}
function inherits(ctor, superCtor) {
  ctor.super_ = superCtor, Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}
function deprecate(fn, msg) {
  let warned = !1;
  return function(...a2) {
    return !warned && msg && (warned = !0, globalThis.process?.emitWarning?.(`DeprecationWarning: ${msg}`)), fn.apply(this, a2);
  };
}
function isDeepStrictEqual(a2, b) {
  if (Object.is(a2, b)) return !0;
  if (typeof a2 != "object" || typeof b != "object" || !a2 || !b || Object.getPrototypeOf(a2) !== Object.getPrototypeOf(b)) return !1;
  if (a2 instanceof Date) return a2.getTime() === b.getTime();
  if (a2 instanceof Map) return a2.size === b.size && [...a2].every(([k, v]) => isDeepStrictEqual(v, b.get(k)));
  if (a2 instanceof Set) return a2.size === b.size && [...a2].every((v) => b.has(v));
  let ka = Object.keys(a2), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => isDeepStrictEqual(a2[k], b[k]));
}
var tag = (x) => Object.prototype.toString.call(x).slice(8, -1), types = {
  isPromise: (x) => x instanceof Promise,
  isRegExp: (x) => x instanceof RegExp,
  isDate: (x) => x instanceof Date,
  isMap: (x) => x instanceof Map,
  isSet: (x) => x instanceof Set,
  isNativeError: (x) => x instanceof Error,
  isTypedArray: (x) => ArrayBuffer.isView(x) && !(x instanceof DataView),
  isUint8Array: (x) => x instanceof Uint8Array,
  isArrayBuffer: (x) => x instanceof ArrayBuffer,
  isAnyArrayBuffer: (x) => x instanceof ArrayBuffer || typeof SharedArrayBuffer < "u" && x instanceof SharedArrayBuffer,
  isArrayBufferView: (x) => ArrayBuffer.isView(x),
  isAsyncFunction: (x) => tag(x) === "AsyncFunction",
  isGeneratorFunction: (x) => tag(x) === "GeneratorFunction" || tag(x) === "AsyncGeneratorFunction",
  isGeneratorObject: (x) => tag(x) === "Generator",
  isBoxedPrimitive: (x) => x instanceof Number || x instanceof String || x instanceof Boolean,
  isProxy: () => !1,
  isWeakMap: (x) => x instanceof WeakMap,
  isWeakSet: (x) => x instanceof WeakSet,
  isDataView: (x) => x instanceof DataView,
  isKeyObject: () => !1,
  isCryptoKey: () => !1
};
function debuglog(section) {
  let enabled = new RegExp(`\\b${section}\\b`, "i").test(globalThis.process?.env?.NODE_DEBUG ?? ""), fn = (...a2) => enabled && globalThis.process.stderr.write(`${section.toUpperCase()}: ${format2(...a2)}
`);
  return fn.enabled = enabled, fn;
}
var stripVTControlCharacters = (s2) => s2.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ""), STYLES = { bold: [1, 22], dim: [2, 22], italic: [3, 23], underline: [4, 24], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39], cyan: [36, 39], white: [37, 39], gray: [90, 39], grey: [90, 39] };
function styleText(f, text) {
  for (let s2 of Array.isArray(f) ? f : [f]) {
    let c = STYLES[s2];
    c && (text = `\x1B[${c[0]}m${text}\x1B[${c[1]}m`);
  }
  return text;
}
var util = {
  inspect,
  format: format2,
  formatWithOptions: (_o, ...a2) => format2(...a2),
  promisify,
  callbackify: callbackify2,
  inherits,
  deprecate,
  isDeepStrictEqual,
  types,
  debuglog,
  debug: debuglog,
  stripVTControlCharacters,
  styleText,
  TextEncoder,
  TextDecoder,
  isArray: Array.isArray,
  isError: (x) => x instanceof Error,
  isFunction: (x) => typeof x == "function",
  isString: (x) => typeof x == "string",
  isNumber: (x) => typeof x == "number",
  isObject: (x) => x !== null && typeof x == "object",
  isPrimitive: (x) => x === null || typeof x != "object" && typeof x != "function",
  isUndefined: (x) => x === void 0,
  isNullOrUndefined: (x) => x == null,
  isRegExp: types.isRegExp,
  isDate: types.isDate,
  toUSVString: (s2) => s2,
  aborted: (signal) => new Promise((r) => signal.addEventListener("abort", () => r(), { once: !0 }))
}, util_default = util;

// src/node/modules/http.ts
var import_buffer2 = __toESM(require_buffer(), 1), import_events3 = __toESM(require_events(), 1), import_readable_stream2 = __toESM(require_browser(), 1);
var STATUS_CODES = {
  100: "Continue",
  101: "Switching Protocols",
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  206: "Partial Content",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  409: "Conflict",
  410: "Gone",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout"
}, METHODS = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "CONNECT", "TRACE"], FakeSocket = class extends import_events3.EventEmitter {
  remoteAddress = "127.0.0.1";
  remotePort = 5e4;
  localAddress = "127.0.0.1";
  localPort;
  encrypted = !1;
  readable = !0;
  writable = !0;
  constructor(port) {
    super(), this.localPort = port;
  }
  setTimeout() {
    return this;
  }
  setNoDelay() {
    return this;
  }
  setKeepAlive() {
    return this;
  }
  destroy() {
    return this;
  }
  end() {
    return this;
  }
  write() {
    return !0;
  }
  address() {
    return { address: "127.0.0.1", family: "IPv4", port: this.localPort };
  }
  ref() {
    return this;
  }
  unref() {
    return this;
  }
}, IncomingMessage = class extends import_readable_stream2.Readable {
  method = "GET";
  url = "/";
  headers = {};
  rawHeaders = [];
  httpVersion = "1.1";
  httpVersionMajor = 1;
  httpVersionMinor = 1;
  statusCode;
  statusMessage;
  socket;
  connection;
  complete = !1;
  trailers = {};
  aborted = !1;
  constructor(socket) {
    super(), this.socket = this.connection = socket ?? new FakeSocket(0);
  }
  _read() {
  }
  setTimeout() {
    return this;
  }
}, OutgoingMessage = class extends import_readable_stream2.Writable {
  _headers = /* @__PURE__ */ new Map();
  headersSent = !1;
  finished = !1;
  sendDate = !0;
  getHeader(n) {
    return this._headers.get(n.toLowerCase())?.[1];
  }
  setHeader(n, v) {
    return this._headers.set(n.toLowerCase(), [n, Array.isArray(v) ? v.map(String) : String(v)]), this;
  }
  appendHeader(n, v) {
    let cur = this.getHeader(n), add = Array.isArray(v) ? v : [v];
    return this.setHeader(n, cur === void 0 ? add : [...Array.isArray(cur) ? cur : [cur], ...add]), this;
  }
  hasHeader(n) {
    return this._headers.has(n.toLowerCase());
  }
  removeHeader(n) {
    this._headers.delete(n.toLowerCase());
  }
  getHeaders() {
    return Object.fromEntries([...this._headers].map(([k, [, v]]) => [k, v]));
  }
  getHeaderNames() {
    return [...this._headers.keys()];
  }
  flushHeaders() {
  }
  setTimeout() {
    return this;
  }
}, ServerResponse = class extends OutgoingMessage {
  statusCode = 200;
  statusMessage = "";
  req;
  socket;
  connection;
  id;
  constructor(req, id) {
    super(), this.req = req, this.id = id, this.socket = this.connection = req.socket;
  }
  writeHead(status, msg, headers) {
    if (this.statusCode = status, typeof msg == "string" ? this.statusMessage = msg : headers = msg, Array.isArray(headers))
      for (let i = 0; i < headers.length; i += 2) this.setHeader(String(headers[i]), headers[i + 1]);
    else if (headers) for (let [k, v] of Object.entries(headers)) v !== void 0 && this.setHeader(k, v);
    return this;
  }
  writeContinue() {
  }
  writeEarlyHints() {
  }
  sendHead() {
    if (this.headersSent) return;
    this.headersSent = !0;
    let hdrs = [];
    for (let [, [name, v]] of this._headers) for (let x of Array.isArray(v) ? v : [v]) hdrs.push([name, x]);
    this.sendDate && !this._headers.has("date") && hdrs.push(["Date", (/* @__PURE__ */ new Date()).toUTCString()]), post({ type: "http-head", id: this.id, status: this.statusCode, statusText: this.statusMessage || STATUS_CODES[this.statusCode] || "", headers: hdrs });
  }
  _write(chunk, enc2, cb) {
    this.sendHead();
    let b = typeof chunk == "string" ? import_buffer2.Buffer.from(chunk, enc2) : import_buffer2.Buffer.from(chunk);
    b.byteLength && this.req.method !== "HEAD" && post({ type: "http-chunk", id: this.id, data: new Uint8Array(b) }), cb();
  }
  _final(cb) {
    this.sendHead(), post({ type: "http-end", id: this.id }), this.finished = !0, cb();
  }
}, servers = /* @__PURE__ */ new Map(), inflight = /* @__PURE__ */ new Map(), autoPort = 3e3, Server = class extends import_events3.EventEmitter {
  listening = !1;
  port = 0;
  release = null;
  timeout = 0;
  keepAliveTimeout = 5e3;
  headersTimeout = 6e4;
  requestTimeout = 3e5;
  maxHeadersCount = null;
  constructor(opts, listener) {
    super(), typeof opts == "function" && (listener = opts), listener && this.on("request", listener);
  }
  listen(...args) {
    let cb = typeof args[args.length - 1] == "function" ? args.pop() : void 0, port, first = args[0];
    if (first && typeof first == "object" ? port = Number(first.port ?? 0) : port = Number(first ?? 0), !port) {
      for (; servers.has(autoPort); ) autoPort++;
      port = autoPort++;
    }
    return servers.has(port) ? (queueMicrotask(() => this.emit("error", Object.assign(new Error(`listen EADDRINUSE: address already in use :::${port}`), { code: "EADDRINUSE", port }))), this) : (this.port = port, servers.set(port, this), this.release = ref(), this.listening = !0, post({ type: "listen", port }), cb && this.once("listening", cb), queueMicrotask(() => this.emit("listening")), this);
  }
  address() {
    return this.listening ? { address: "::", family: "IPv6", port: this.port } : null;
  }
  close(cb) {
    return this.listening && (servers.delete(this.port), post({ type: "unlisten", port: this.port }), this.listening = !1, this.release?.(), queueMicrotask(() => this.emit("close"))), cb && queueMicrotask(() => cb()), this;
  }
  closeAllConnections() {
  }
  closeIdleConnections() {
  }
  setTimeout() {
    return this;
  }
  ref() {
    return this;
  }
  unref() {
    return this.release?.(), this;
  }
  /** @internal */
  _handle(m) {
    let sock = new FakeSocket(this.port), req = new IncomingMessage(sock);
    req.method = m.method, req.url = m.url;
    for (let [k, v] of m.headers) {
      let key = k.toLowerCase();
      req.rawHeaders.push(k, v), req.headers[key] = key in req.headers ? `${req.headers[key]}, ${v}` : v;
    }
    req.headers.host ??= `localhost:${this.port}`;
    let res = new ServerResponse(req, m.id);
    inflight.set(m.id, res), res.on("finish", () => {
      inflight.delete(m.id), res.emit("close");
    }), this.emit("connection", sock), this.emit("request", req, res), m.body && m.body.byteLength && req.push(import_buffer2.Buffer.from(m.body)), req.push(null), req.complete = !0;
  }
};
function handleHttpMessage(m) {
  if (m.type === "http-request") {
    let s2 = servers.get(m.port);
    if (!s2) {
      post({ type: "http-head", id: m.id, status: 502, statusText: "Bad Gateway", headers: [] }), post({ type: "http-end", id: m.id });
      return;
    }
    try {
      s2._handle(m);
    } catch (e) {
      post({ type: "http-head", id: m.id, status: 500, statusText: "Internal Server Error", headers: [["content-type", "text/plain"]] }), post({ type: "http-chunk", id: m.id, data: new TextEncoder().encode(String(e?.stack ?? e)) }), post({ type: "http-end", id: m.id });
    }
  } else if (m.type === "http-abort") {
    let res = inflight.get(m.id);
    res?.req.emit("aborted"), res?.emit("close"), inflight.delete(m.id);
  }
}
function createServer(opts, listener) {
  return new Server(opts, listener);
}
function localPort(u) {
  return ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(u.hostname) ? Number(u.port || (u.protocol === "https:" ? 443 : 80)) : null;
}
async function containerFetch(input, init) {
  let req = new Request(input, init), u = new URL(req.url), port = localPort(u);
  if (port !== null) {
    let body = req.method === "GET" || req.method === "HEAD" ? null : await req.arrayBuffer(), r = await asyncCall("fetch-local", port, req.method, req.url, [...req.headers], body);
    return new Response(r.status === 204 || r.status === 304 ? null : r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
  }
  return nativeFetch(req);
}
var nativeFetch = globalThis.fetch.bind(globalThis), ClientRequest = class extends OutgoingMessage {
  constructor(url2, opts, cb) {
    super();
    this.url = url2;
    this.opts = opts;
    cb && this.once("response", cb);
    for (let [k, v] of Object.entries(opts.headers ?? {})) this.setHeader(k, v);
  }
  url;
  opts;
  chunks = [];
  aborter = new AbortController();
  _write(chunk, enc2, cb) {
    this.chunks.push(typeof chunk == "string" ? import_buffer2.Buffer.from(chunk, enc2) : chunk), cb();
  }
  _final(cb) {
    let release = ref(), method = (this.opts.method ?? "GET").toUpperCase(), headers = [];
    for (let [, [n, v]] of this._headers) for (let x of Array.isArray(v) ? v : [v]) headers.push([n, x]);
    let body = method === "GET" || method === "HEAD" ? void 0 : import_buffer2.Buffer.concat(this.chunks);
    containerFetch(this.url.href, { method, headers, body, signal: this.aborter.signal }).then(async (r) => {
      let res = new IncomingMessage();
      res.statusCode = r.status, res.statusMessage = r.statusText, r.headers.forEach((v, k) => {
        res.headers[k] = v, res.rawHeaders.push(k, v);
      }), this.emit("response", res);
      let reader = r.body?.getReader();
      if (reader)
        for (; ; ) {
          let { done, value } = await reader.read();
          if (done) break;
          res.push(import_buffer2.Buffer.from(value));
        }
      res.push(null);
    }).catch((e) => this.emit("error", e)).finally(release), cb();
  }
  abort() {
    this.aborter.abort();
  }
  destroy(e) {
    return this.aborter.abort(), super.destroy(e);
  }
  setNoDelay() {
  }
  setSocketKeepAlive() {
  }
};
function normalizeArgs(proto, a2, b, c) {
  let url2, opts = {}, cb;
  if (typeof a2 == "string" || a2 instanceof URL)
    url2 = new URL(String(a2)), typeof b == "function" ? cb = b : (opts = b ?? {}, cb = c);
  else {
    opts = a2 ?? {}, cb = b;
    let host = opts.hostname ?? opts.host ?? "localhost";
    url2 = new URL(`${proto}//${host}${opts.port ? ":" + opts.port : ""}${opts.path ?? "/"}`);
  }
  return [url2, opts, cb];
}
function makeHttp(proto) {
  let request = (a2, b, c) => {
    let [u, o, cb] = normalizeArgs(proto, a2, b, c);
    return new ClientRequest(u, o, cb);
  }, get = (a2, b, c) => {
    let r = request(a2, b, c);
    return r.end(), r;
  };
  class Agent {
    constructor(options) {
      this.options = options;
    }
    options;
    destroy() {
    }
  }
  return {
    createServer,
    Server,
    IncomingMessage,
    ServerResponse,
    OutgoingMessage,
    ClientRequest,
    Agent,
    globalAgent: new Agent(),
    request,
    get,
    STATUS_CODES,
    METHODS,
    maxHeaderSize: 16384,
    validateHeaderName: () => {
    },
    validateHeaderValue: () => {
    }
  };
}

// src/node/modules/misc.ts
var import_buffer3 = __toESM(require_buffer(), 1), import_events4 = __toESM(require_events(), 1);
var os = {
  EOL: `
`,
  platform: () => "linux",
  type: () => "Linux",
  arch: () => "x64",
  release: () => "6.0.0-clover",
  version: () => "#1 SMP",
  machine: () => "x86_64",
  hostname: () => "clover",
  homedir: () => globalThis.process?.env?.HOME ?? "/home",
  tmpdir: () => "/tmp",
  userInfo: () => ({ username: "clover", uid: 1e3, gid: 1e3, shell: "/bin/jsh", homedir: os.homedir() }),
  cpus: () => Array.from({ length: navigator.hardwareConcurrency || 4 }, () => ({ model: "virtual", speed: 2e3, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } })),
  availableParallelism: () => navigator.hardwareConcurrency || 4,
  totalmem: () => 8 * 1024 ** 3,
  freemem: () => 4 * 1024 ** 3,
  uptime: () => Math.floor(performance.now() / 1e3),
  loadavg: () => [0, 0, 0],
  networkInterfaces: () => ({ lo: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: !0, cidr: "127.0.0.1/8" }] }),
  endianness: () => "LE",
  constants: { signals: { SIGINT: 2, SIGTERM: 15, SIGKILL: 9, SIGHUP: 1 }, errno: {} },
  devNull: "/dev/null"
}, url = {
  URL,
  URLSearchParams,
  fileURLToPath: (u) => decodeURIComponent(new URL(String(u)).pathname),
  pathToFileURL: (p) => new URL("file://" + encodeURI(p.startsWith("/") ? p : `${globalThis.process.cwd()}/${p}`)),
  parse(s2, parseQuery) {
    let u, hasProto = /^[a-z][a-z0-9+.-]*:/i.test(s2);
    try {
      u = new URL(s2, hasProto ? void 0 : "http://__relative__");
    } catch {
      return { href: s2, path: s2, pathname: s2, search: null, query: null, hash: null };
    }
    let rel = !hasProto, search = u.search || null;
    return {
      protocol: rel ? null : u.protocol,
      slashes: rel ? null : s2.includes("//"),
      auth: u.username ? `${u.username}${u.password ? ":" + u.password : ""}` : null,
      host: rel ? null : u.host,
      port: rel ? null : u.port || null,
      hostname: rel ? null : u.hostname,
      hash: u.hash || null,
      search,
      query: parseQuery ? Object.fromEntries(u.searchParams) : search ? search.slice(1) : null,
      pathname: u.pathname,
      path: u.pathname + (u.search || ""),
      href: rel ? s2 : u.href
    };
  },
  format(o) {
    if (typeof o == "string") return o;
    if (o instanceof URL) return o.href;
    let proto = o.protocol ?? "", host = o.host ?? `${o.hostname ?? ""}${o.port ? ":" + o.port : ""}`, q = o.search ?? "";
    return !q && o.query && typeof o.query == "object" && (q = "?" + new URLSearchParams(o.query).toString()), `${proto}${proto || host ? "//" : ""}${host}${o.pathname ?? ""}${q}${o.hash ?? ""}`;
  },
  resolve: (from, to) => new URL(to, new URL(from, "resolve://")).href.replace(/^resolve:\/\//, ""),
  domainToASCII: (d) => d,
  domainToUnicode: (d) => d
}, querystring = {
  parse(s2, sep = "&", eq = "=") {
    let out = {};
    for (let part of (s2 || "").split(sep)) {
      if (!part) continue;
      let i = part.indexOf(eq), k = decode2(i < 0 ? part : part.slice(0, i)), v = i < 0 ? "" : decode2(part.slice(i + 1)), cur = out[k];
      out[k] = cur === void 0 ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
    }
    return out;
  },
  stringify(o, sep = "&", eq = "=") {
    return Object.entries(o ?? {}).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${encodeURIComponent(k)}${eq}${encodeURIComponent(x == null ? "" : String(x))}`)).join(sep);
  },
  escape: encodeURIComponent,
  unescape: decodeURIComponent
}, decode2 = (s2) => {
  try {
    return decodeURIComponent(s2.replace(/\+/g, " "));
  } catch {
    return s2;
  }
};
querystring.decode = querystring.parse;
querystring.encode = querystring.stringify;
var AssertionError = class extends Error {
  code = "ERR_ASSERTION";
  constructor(o) {
    super(o.message ?? `${inspect(o.actual)} ${o.operator} ${inspect(o.expected)}`), this.name = "AssertionError", Object.assign(this, { actual: o.actual, expected: o.expected, operator: o.operator });
  }
}, fail = (actual, expected, message, operator) => {
  throw message instanceof Error ? message : new AssertionError({ message, actual, expected, operator });
}, looseEq = (a2, b) => {
  if (a2 == b) return !0;
  if (typeof a2 != "object" || typeof b != "object" || !a2 || !b) return !1;
  let ka = Object.keys(a2);
  return ka.length === Object.keys(b).length && ka.every((k) => looseEq(a2[k], b[k]));
};
function assertFn(v, msg) {
  v || fail(v, !0, msg ?? "The expression evaluated to a falsy value", "==");
}
var matchesErr = (e, exp) => exp ? typeof exp == "function" ? exp.prototype !== void 0 && e instanceof exp ? !0 : exp(e) === !0 : exp instanceof RegExp ? exp.test(String(e?.message ?? e)) : typeof exp == "object" ? Object.entries(exp).every(([k, v]) => v instanceof RegExp ? v.test(e[k]) : isDeepStrictEqual(e[k], v)) : !0 : !0, assert = Object.assign(assertFn, {
  ok: assertFn,
  AssertionError,
  fail: (msg) => fail(void 0, void 0, msg ?? "Failed", "fail"),
  equal: (a2, b, m) => {
    a2 == b || fail(a2, b, m, "==");
  },
  notEqual: (a2, b, m) => {
    a2 != b || fail(a2, b, m, "!=");
  },
  strictEqual: (a2, b, m) => {
    Object.is(a2, b) || fail(a2, b, m, "strictEqual");
  },
  notStrictEqual: (a2, b, m) => {
    !Object.is(a2, b) || fail(a2, b, m, "notStrictEqual");
  },
  deepEqual: (a2, b, m) => {
    looseEq(a2, b) || fail(a2, b, m, "deepEqual");
  },
  notDeepEqual: (a2, b, m) => {
    !looseEq(a2, b) || fail(a2, b, m, "notDeepEqual");
  },
  deepStrictEqual: (a2, b, m) => {
    isDeepStrictEqual(a2, b) || fail(a2, b, m, "deepStrictEqual");
  },
  notDeepStrictEqual: (a2, b, m) => {
    !isDeepStrictEqual(a2, b) || fail(a2, b, m, "notDeepStrictEqual");
  },
  throws(fn, exp, m) {
    try {
      fn();
    } catch (e) {
      if (!matchesErr(e, exp)) throw e;
      return;
    }
    fail(void 0, exp, typeof exp == "string" ? exp : m ?? "Missing expected exception.", "throws");
  },
  doesNotThrow(fn) {
    fn();
  },
  async rejects(p, exp, m) {
    try {
      await (typeof p == "function" ? p() : p);
    } catch (e) {
      if (!matchesErr(e, exp)) throw e;
      return;
    }
    fail(void 0, exp, m ?? "Missing expected rejection.", "rejects");
  },
  async doesNotReject(p) {
    await (typeof p == "function" ? p() : p);
  },
  match: (s2, re, m) => {
    re.test(s2) || fail(s2, re, m, "match");
  },
  doesNotMatch: (s2, re, m) => {
    !re.test(s2) || fail(s2, re, m, "doesNotMatch");
  },
  ifError: (e) => {
    if (e != null) throw e;
  }
});
assert.strict = assert;
var Hash = class _Hash {
  constructor(alg, key) {
    this.alg = alg;
    this.key = key;
  }
  alg;
  key;
  parts = [];
  update(d, enc2) {
    return this.parts.push(typeof d == "string" ? import_buffer3.Buffer.from(d, enc2 ?? "utf8") : d), this;
  }
  digest(enc2) {
    let data = import_buffer3.Buffer.concat(this.parts), out = import_buffer3.Buffer.from(this.key ? syncCall("hmac", this.alg, this.key, data) : syncCall("hash", this.alg, data));
    return enc2 ? out.toString(enc2) : out;
  }
  copy() {
    let h = new _Hash(this.alg, this.key);
    return h.parts = [...this.parts], h;
  }
}, crypto = {
  webcrypto: globalThis.crypto,
  subtle: globalThis.crypto.subtle,
  getRandomValues: (a2) => globalThis.crypto.getRandomValues(a2),
  randomUUID: () => globalThis.crypto.randomUUID(),
  randomBytes(n, cb) {
    let b = import_buffer3.Buffer.alloc(n);
    for (let i = 0; i < n; i += 65536) globalThis.crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536)));
    return cb && queueMicrotask(() => cb(null, b)), b;
  },
  randomFillSync(b) {
    return globalThis.crypto.getRandomValues(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)), b;
  },
  randomInt(min, max) {
    return max === void 0 && ([min, max] = [0, min]), min + Math.floor(globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 * (max - min));
  },
  createHash: (alg) => new Hash(alg),
  createHmac: (alg, key) => new Hash(alg, typeof key == "string" ? import_buffer3.Buffer.from(key) : key),
  getHashes: () => ["sha1", "sha256", "sha384", "sha512"],
  timingSafeEqual: (a2, b) => a2.byteLength === b.byteLength && a2.every((x, i) => x === b[i]),
  hash: (alg, data, enc2 = "hex") => new Hash(alg).update(data).digest(enc2),
  createCipheriv: unsupportedFn("crypto.createCipheriv"),
  createDecipheriv: unsupportedFn("crypto.createDecipheriv"),
  pbkdf2Sync: unsupportedFn("crypto.pbkdf2Sync"),
  scryptSync: unsupportedFn("crypto.scryptSync"),
  generateKeyPairSync: unsupportedFn("crypto.generateKeyPairSync"),
  constants: {}
}, Interface = class extends import_events4.EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts;
    this.release = ref();
    let input = opts.input;
    input?.on("data", (d) => {
      this.buf += String(d);
      let i;
      for (; (i = this.buf.indexOf(`
`)) >= 0; ) {
        let line = this.buf.slice(0, i).replace(/\r$/, "");
        this.buf = this.buf.slice(i + 1);
        let p = this.pending.shift();
        p ? p(line) : this.emit("line", line);
      }
    }), input?.on("end", () => this.close()), input?.resume?.();
  }
  opts;
  buf = "";
  release;
  pending = [];
  closed = !1;
  terminal = !1;
  line = "";
  setPrompt(p) {
    this.opts.prompt = p;
  }
  getPrompt() {
    return this.opts.prompt ?? "> ";
  }
  prompt() {
    this.opts.output?.write(this.getPrompt());
  }
  question(q, a2, b) {
    let cb = typeof a2 == "function" ? a2 : b;
    if (this.opts.output?.write(q), cb) this.pending.push(cb);
    else return new Promise((r) => this.pending.push(r));
  }
  write(s2) {
    this.opts.output?.write(s2);
  }
  pause() {
    return this;
  }
  resume() {
    return this;
  }
  close() {
    this.closed || (this.closed = !0, this.buf && this.emit("line", this.buf), this.emit("close"), this.release());
  }
  async *[Symbol.asyncIterator]() {
    let q = [], wake = null;
    for (this.on("line", (l) => (q.push(l), wake?.())), this.on("close", () => wake?.()); ; )
      if (q.length) yield q.shift();
      else {
        if (this.closed) return;
        await new Promise((r) => wake = r);
      }
  }
}, readline = {
  createInterface: (input, output) => new Interface(input && typeof input == "object" && "input" in input ? input : { input, output }),
  Interface,
  clearLine: (s2, _d, cb) => (s2.write("\x1B[2K"), cb?.(), !0),
  cursorTo: (s2, x, _y, cb) => (s2.write(`\x1B[${x + 1}G`), cb?.(), !0),
  moveCursor: (s2, dx, dy, cb) => (dx && s2.write(dx > 0 ? `\x1B[${dx}C` : `\x1B[${-dx}D`), dy && s2.write(dy > 0 ? `\x1B[${dy}B` : `\x1B[${-dy}A`), cb?.(), !0),
  clearScreenDown: (s2) => (s2.write("\x1B[J"), !0),
  emitKeypressEvents: () => {
  }
}, isIPv4 = (s2) => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(s2), isIPv6 = (s2) => s2.includes(":") && /^[0-9a-f:.]+$/i.test(s2), net = {
  isIP: (s2) => isIPv4(s2) ? 4 : isIPv6(s2) ? 6 : 0,
  isIPv4,
  isIPv6,
  createServer: unsupportedFn("net.createServer"),
  createConnection: unsupportedFn("net.createConnection"),
  connect: unsupportedFn("net.connect"),
  Socket: class {
    constructor() {
      throw unsupported("net.Socket");
    }
  },
  Server: class {
    constructor() {
      throw unsupported("net.Server");
    }
  }
}, tty = { isatty: (fd) => !!(fd <= 2 && globalThis.process?.stdout?.isTTY), ReadStream: class {
}, WriteStream: class {
} }, asyncHooks = {
  AsyncLocalStorage: class {
    store;
    getStore() {
      return this.store;
    }
    run(store, fn, ...args) {
      let prev = this.store;
      this.store = store;
      try {
        let r = fn(...args);
        return r instanceof Promise ? r.finally(() => this.store = prev) : (this.store = prev, r);
      } catch (e) {
        throw this.store = prev, e;
      }
    }
    enterWith(store) {
      this.store = store;
    }
    exit(fn, ...a2) {
      return fn(...a2);
    }
    disable() {
    }
  },
  AsyncResource: class {
    constructor(type) {
      this.type = type;
    }
    type;
    runInAsyncScope(fn, thisArg, ...a2) {
      return fn.apply(thisArg, a2);
    }
    emitDestroy() {
      return this;
    }
    bind(fn) {
      return fn;
    }
    static bind(fn) {
      return fn;
    }
  },
  createHook: () => ({ enable() {
  }, disable() {
  } }),
  executionAsyncId: () => 1,
  triggerAsyncId: () => 0
}, vm = {
  runInThisContext: (code) => (0, eval)(code),
  runInNewContext: (code, ctx = {}) => new Function(...Object.keys(ctx), `return eval(${JSON.stringify(code)})`)(...Object.values(ctx)),
  createContext: (o = {}) => o,
  isContext: () => !0,
  Script: class {
    constructor(code) {
      this.code = code;
    }
    code;
    runInThisContext() {
      return (0, eval)(this.code);
    }
    runInNewContext(ctx = {}) {
      return vm.runInNewContext(this.code, ctx);
    }
    runInContext(ctx = {}) {
      return vm.runInNewContext(this.code, ctx);
    }
  }
}, workerThreads = { isMainThread: !0, parentPort: null, workerData: null, threadId: 0, Worker: class {
  constructor() {
    throw unsupported("worker_threads.Worker");
  }
}, MessageChannel, MessagePort, BroadcastChannel }, perfHooks = { performance: globalThis.performance, PerformanceObserver: class {
  observe() {
  }
  disconnect() {
  }
}, monitorEventLoopDelay: () => ({ enable() {
}, disable() {
}, percentile: () => 0 }) }, diagnosticsChannel = {
  channel: () => ({ hasSubscribers: !1, publish() {
  }, subscribe() {
  }, unsubscribe() {
  } }),
  hasSubscribers: () => !1,
  subscribe() {
  },
  unsubscribe() {
  },
  tracingChannel: () => ({ hasSubscribers: !1, traceSync: (fn) => fn(), tracePromise: (fn) => fn(), subscribe() {
  }, unsubscribe() {
  } })
};
function unsupported(what) {
  return Object.assign(new Error(`[clover] ${what} is not supported in the browser runtime`), { code: "ERR_CLOVER_UNSUPPORTED" });
}
function unsupportedFn(what) {
  return () => {
    throw unsupported(what);
  };
}
function unsupportedModule(name, extra = {}) {
  return new Proxy(extra, {
    get(t, k) {
      if (k in t) return t[k];
      if (!(k === "__esModule" || typeof k == "symbol" || k === "then" || k === "default"))
        return unsupportedFn(`${name}.${String(k)}`);
    }
  });
}

// src/node/worker.ts
var g = globalThis, exiting = !1, proc;
function exit(code) {
  if (!exiting) {
    exiting = !0, proc.exitCode = code;
    try {
      proc.emit("exit", code);
    } catch {
    }
    post({ type: "exit", code: proc.exitCode ?? code });
  }
  throw new ExitSignal(code);
}
function printError(e) {
  if (e instanceof ExitSignal) return;
  let err = e, text = err && typeof err == "object" && err.stack ? err.stack : inspect(e);
  post({ type: "stderr", data: `${text.includes(String(err?.message)) || !err?.message ? text : `${err.name}: ${err.message}
${text}`}
` });
}
function fatal(e) {
  if (!(e instanceof ExitSignal || exiting)) {
    if (proc?.listenerCount("uncaughtException")) {
      proc.emit("uncaughtException", e);
      return;
    }
    printError(e);
    try {
      exit(1);
    } catch {
    }
  }
}
var nSetTimeout = globalThis.setTimeout.bind(globalThis), nClearTimeout = globalThis.clearTimeout.bind(globalThis), nSetInterval = globalThis.setInterval.bind(globalThis), nClearInterval = globalThis.clearInterval.bind(globalThis), Timeout = class {
  constructor(fn, ms, args, repeat) {
    this.fn = fn;
    this.ms = ms;
    this.args = args;
    this.repeat = repeat;
    this.release = ref(), this.handle = this.start();
  }
  fn;
  ms;
  args;
  repeat;
  release;
  handle;
  start() {
    let run = () => {
      this.repeat || this.done();
      try {
        this.fn(...this.args);
      } catch (e) {
        fatal(e);
      }
    };
    return this.repeat ? nSetInterval(run, this.ms) : nSetTimeout(run, this.ms);
  }
  done() {
    this.release?.(), this.release = null;
  }
  clear() {
    (this.repeat ? nClearInterval : nClearTimeout)(this.handle), this.done();
  }
  ref() {
    return this.release || (this.release = ref()), this;
  }
  unref() {
    return this.done(), this;
  }
  hasRef() {
    return !!this.release;
  }
  refresh() {
    return (this.repeat ? nClearInterval : nClearTimeout)(this.handle), this.handle = this.start(), this;
  }
  close() {
    return this.clear(), this;
  }
  [Symbol.toPrimitive]() {
    return this.handle;
  }
}, byHandle = /* @__PURE__ */ new Map(), timers = {
  setTimeout: (fn, ms = 0, ...args) => {
    let t = new Timeout(fn, ms, args, !1);
    return byHandle.set(+t, t), t;
  },
  setInterval: (fn, ms = 0, ...args) => {
    let t = new Timeout(fn, ms, args, !0);
    return byHandle.set(+t, t), t;
  },
  setImmediate: (fn, ...args) => {
    let t = new Timeout(fn, 0, args, !1);
    return byHandle.set(+t, t), t;
  },
  clearTimeout: (t) => {
    t instanceof Timeout ? t.clear() : typeof t == "number" && byHandle.get(t)?.clear();
  }
}, timersPromises = {
  setTimeout: (ms = 0, v, o) => new Promise((res, rej) => {
    let t = timers.setTimeout(() => res(v), ms);
    o?.signal?.addEventListener("abort", () => (t.clear(), rej(o.signal.reason)));
  }),
  setImmediate: (v) => new Promise((res) => timers.setImmediate(() => res(v))),
  async *setInterval(ms = 0, v) {
    for (; ; )
      await timersPromises.setTimeout(ms), yield v;
  },
  scheduler: { wait: (ms) => timersPromises.setTimeout(ms), yield: () => timersPromises.setImmediate() }
}, http = makeHttp("http:"), https = makeHttp("https:"), events = Object.assign(import_events5.default, { EventEmitter: import_events5.EventEmitter, once: import_events5.default.once, on: import_events5.default.on }), builtinFactories = {
  assert: () => assert,
  "assert/strict": () => assert,
  async_hooks: () => asyncHooks,
  buffer: () => ({ Buffer: import_buffer4.Buffer, constants: { MAX_LENGTH: 2 ** 31 - 1 }, kMaxLength: 2 ** 31 - 1, Blob, atob, btoa, File: globalThis.File }),
  child_process: () => unsupportedModule("child_process"),
  cluster: () => unsupportedModule("cluster", { isMaster: !0, isPrimary: !0, isWorker: !1 }),
  console: () => console,
  constants: () => ({ ...os.constants, ...fs_default.constants }),
  crypto: () => crypto,
  dgram: () => unsupportedModule("dgram"),
  diagnostics_channel: () => diagnosticsChannel,
  dns: () => unsupportedModule("dns", { promises: unsupportedModule("dns.promises") }),
  "dns/promises": () => unsupportedModule("dns.promises"),
  domain: () => ({ create: () => ({ run: (fn) => fn(), on() {
  }, add() {
  }, enter() {
  }, exit() {
  } }) }),
  events: () => events,
  fs: () => fs_default,
  "fs/promises": () => promises,
  http: () => http,
  http2: () => unsupportedModule("http2"),
  https: () => https,
  inspector: () => unsupportedModule("inspector", { url: () => {
  } }),
  module: () => moduleBuiltin,
  net: () => net,
  os: () => os,
  path: () => path_default,
  "path/posix": () => path_default,
  perf_hooks: () => perfHooks,
  process: () => proc,
  punycode: () => ({ toASCII: (s2) => s2, toUnicode: (s2) => s2 }),
  querystring: () => querystring,
  readline: () => readline,
  "readline/promises": () => ({
    ...readline,
    createInterface: (...a2) => {
      let rl = readline.createInterface(...a2);
      return Object.assign(rl, { question: (q) => rl.question(q) });
    }
  }),
  repl: () => unsupportedModule("repl"),
  stream: () => streamMod,
  "stream/promises": () => streamMod.promises,
  "stream/web": () => ({ ReadableStream, WritableStream, TransformStream, TextEncoderStream, TextDecoderStream }),
  string_decoder: () => ({ StringDecoder: import_string_decoder.StringDecoder }),
  sys: () => util_default,
  timers: () => ({ ...timers, clearInterval: timers.clearTimeout, clearImmediate: timers.clearTimeout, promises: timersPromises }),
  "timers/promises": () => timersPromises,
  tls: () => unsupportedModule("tls"),
  tty: () => tty,
  url: () => url,
  util: () => util_default,
  "util/types": () => util_default.types,
  v8: () => unsupportedModule("v8", { getHeapStatistics: () => ({ heap_size_limit: 4e9, total_heap_size: 1e8, used_heap_size: 5e7 }), serialize: (v) => import_buffer4.Buffer.from(JSON.stringify(v)), deserialize: (b) => JSON.parse(b.toString()) }),
  vm: () => vm,
  wasi: () => unsupportedModule("wasi"),
  worker_threads: () => workerThreads,
  zlib: () => unsupportedModule("zlib", { constants: {} })
}, builtinCache = /* @__PURE__ */ new Map(), builtinModules = Object.keys(builtinFactories);
function builtinName(spec) {
  let n = spec.startsWith("node:") ? spec.slice(5) : spec;
  return n in builtinFactories ? n : null;
}
function loadBuiltin(n) {
  return builtinCache.has(n) || builtinCache.set(n, builtinFactories[n]()), builtinCache.get(n);
}
var cache = /* @__PURE__ */ Object.create(null), mainModule;
function nodePaths(dir) {
  let out = [];
  for (let d = dir; d.endsWith("/node_modules") || out.push(`${d === "/" ? "" : d}/node_modules`), d !== "/"; d = dirname(d))
    ;
  return out;
}
function resolveFrom(spec, dir) {
  return syncCall("resolve", spec, dir);
}
function makeRequire(mod) {
  let req = ((spec) => {
    if (typeof spec != "string") throw new TypeError(`The "id" argument must be of type string. Received ${inspect(spec)}`);
    let b = builtinName(spec);
    if (b) return loadBuiltin(b);
    if (spec.startsWith("node:")) throw Object.assign(new Error(`No such built-in module: ${spec}`), { code: "ERR_UNKNOWN_BUILTIN_MODULE" });
    let resolved = resolveFrom(spec, mod.path);
    return resolved === !1 ? {} : loadFile(resolved, mod);
  }), resolve2 = ((spec, o) => {
    if (builtinName(spec)) return spec;
    for (let dir of o?.paths ?? [mod.path])
      try {
        let r = resolveFrom(spec, dir);
        if (r) return r;
      } catch (e) {
        if (!o?.paths) throw e;
      }
    throw Object.assign(new Error(`Cannot find module '${spec}'`), { code: "MODULE_NOT_FOUND" });
  });
  return resolve2.paths = (s2) => builtinName(s2) ? null : nodePaths(mod.path), req.resolve = resolve2, req.cache = cache, req.main = mainModule, req.extensions = { ".js": () => {
  }, ".json": () => {
  }, ".node": () => {
  } }, req;
}
function createModule(filename, parent) {
  let mod = { id: filename, filename, path: dirname(filename), exports: {}, loaded: !1, parent, children: [], paths: nodePaths(dirname(filename)), require: null };
  return mod.require = makeRequire(mod), mod;
}
function loadFile(filename, parent) {
  let cached = cache[filename];
  if (cached) return cached.exports;
  if (filename.endsWith(".node")) throw new Error(`[clover] native addon '${filename}' cannot be loaded in the browser runtime`);
  let mod = createModule(filename, parent);
  parent?.children.push(mod), cache[filename] = mod;
  try {
    let { code, format: fmt } = syncCall("load", filename);
    if (fmt === "json") mod.exports = JSON.parse(code);
    else {
      let body = (code.startsWith("#!") ? "//" + code : code) + `
//# sourceURL=${filename}`;
      new Function("exports", "require", "module", "__filename", "__dirname", "__clover_meta_url", body).call(mod.exports, mod.exports, mod.require, mod, filename, mod.path, "file://" + filename);
    }
    mod.loaded = !0;
  } catch (e) {
    throw delete cache[filename], e;
  }
  return mod.exports;
}
var moduleBuiltin = Object.assign(
  function() {
  },
  {
    builtinModules,
    isBuiltin: (s2) => !!builtinName(s2),
    createRequire: (from) => {
      let f = String(from);
      return f.startsWith("file://") && (f = decodeURIComponent(new URL(f).pathname)), createModule(f.endsWith("/") ? f + "noop.js" : f, null).require;
    },
    _cache: cache,
    _resolveFilename: (spec, parent) => builtinName(spec) ? spec : resolveFrom(spec, parent?.path ?? proc.cwd()),
    _nodeModulePaths: nodePaths,
    _extensions: { ".js": () => {
    }, ".json": () => {
    } },
    wrap: (s2) => `(function (exports, require, module, __filename, __dirname) { ${s2}
});`,
    register: () => {
    },
    syncBuiltinESMExports: () => {
    },
    findSourceMap: () => {
    },
    enableCompileCache: () => {
    }
  }
);
function installConsole() {
  let out = (s2) => post({ type: "stdout", data: s2 + `
` }), err = (s2) => post({ type: "stderr", data: s2 + `
` }), indent = "", counts = /* @__PURE__ */ new Map(), times = /* @__PURE__ */ new Map(), c = console, ind = (s2) => indent ? s2.replace(/^/gm, indent) : s2;
  c.log = c.info = c.debug = (...a2) => out(ind(format2(...a2))), c.error = c.warn = c.trace = (...a2) => err(ind(format2(...a2))), c.dir = (o, opts) => out(ind(inspect(o, opts))), c.table = (d) => out(ind(inspect(d))), c.group = (...a2) => {
    a2.length && out(ind(format2(...a2))), indent += "  ";
  }, c.groupEnd = () => {
    indent = indent.slice(2);
  }, c.count = (l = "default") => {
    let n = (counts.get(l) ?? 0) + 1;
    counts.set(l, n), out(`${l}: ${n}`);
  }, c.countReset = (l = "default") => {
    counts.delete(l);
  }, c.time = (l = "default") => {
    times.set(l, performance.now());
  }, c.timeEnd = c.timeLog = (l = "default") => {
    let t = times.get(l);
    t !== void 0 && out(`${l}: ${(performance.now() - t).toFixed(3)}ms`), c.timeEnd === c.timeLog && times.delete(l);
  }, c.assert = (v, ...a2) => {
    v || err("Assertion failed" + (a2.length ? ": " + format2(...a2) : ""));
  };
}
function start(m) {
  setSab(m.sab), proc = createProcess({ ...m, exit }), g.process = proc, g.global = globalThis, g.Buffer = import_buffer4.Buffer, g.setTimeout = timers.setTimeout, g.setInterval = timers.setInterval, g.setImmediate = timers.setImmediate, g.clearTimeout = g.clearInterval = g.clearImmediate = timers.clearTimeout, g.fetch = (i, o) => {
    let release2 = ref();
    return containerFetch(i, o).finally(release2);
  }, installConsole();
  let stdin = proc.stdin, stdinRelease = null, origResume = stdin.resume.bind(stdin), origPause = stdin.pause.bind(stdin);
  stdin.resume = () => (stdinRelease ??= ref(), origResume()), stdin.pause = () => (stdinRelease?.(), stdinRelease = null, origPause()), stdin.on("end", () => (stdinRelease?.(), stdinRelease = null)), setIdleHandler(() => {
    if (!exiting)
      try {
        proc.listenerCount("beforeExit") ? (proc.emit("beforeExit", proc.exitCode ?? 0), nativeSetTimeout(() => {
          !exiting && activeRefs() <= 0 && exit(proc.exitCode ?? 0);
        }, 0)) : exit(proc.exitCode ?? 0);
      } catch (e) {
        fatal(e);
      }
  });
  let entry = m.argv[1], release = ref();
  try {
    if (!hasSync()) throw new Error("[clover] `node` requires a cross-origin isolated page (serve with COOP: same-origin + COEP: require-corp)");
    let resolved;
    try {
      resolved = resolveFrom(entry.startsWith("/") ? entry : "./" + entry, proc.cwd());
    } catch (e) {
      throw e.code !== "MODULE_NOT_FOUND" ? e : Object.assign(new Error(`Cannot find module '${entry}'`), { code: "MODULE_NOT_FOUND" });
    }
    let mod = createModule(resolved, null);
    mainModule = mod, mod.require.main = mod, cache[resolved] = mod;
    let { code, format: fmt } = syncCall("load", resolved);
    if (fmt === "json") mod.exports = JSON.parse(code);
    else {
      let body = (code.startsWith("#!") ? "//" + code : code) + `
//# sourceURL=${resolved}`;
      new Function("exports", "require", "module", "__filename", "__dirname", "__clover_meta_url", body).call(mod.exports, mod.exports, mod.require, mod, resolved, mod.path, "file://" + resolved);
    }
    mod.loaded = !0;
  } catch (e) {
    fatal(e);
  } finally {
    release();
  }
}
self.addEventListener("error", (e) => {
  e.preventDefault(), fatal(e.error ?? e.message);
});
self.addEventListener("unhandledrejection", (e) => {
  e.preventDefault(), !(e.reason instanceof ExitSignal) && (proc?.listenerCount("unhandledRejection") ? proc.emit("unhandledRejection", e.reason, e.promise) : fatal(e.reason));
});
self.onmessage = (ev) => {
  let m = ev.data;
  try {
    switch (m.type) {
      case "start":
        start(m);
        break;
      case "stdin":
        proc.stdin.push(m.data);
        break;
      case "stdin-end":
        proc.stdin.end();
        break;
      case "signal":
        proc.listenerCount(m.name) ? proc.emit(m.name, m.name) : exit(130);
        break;
      case "async-result":
        handleAsyncResult(m);
        break;
      case "http-request":
      case "http-abort":
        handleHttpMessage(m);
        break;
    }
  } catch (e) {
    fatal(e);
  }
  scheduleIdleCheck();
};
//# sourceMappingURL=node-worker.js.map
