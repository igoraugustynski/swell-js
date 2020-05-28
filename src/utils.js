const qs = require('qs');
const set = require('lodash/set');
const get = require('lodash/get');
const deepmerge = require('deepmerge');
const { normalizeKeys } = require('object-keys-normalizer');

let options = {};

function merge(x, y, opt = {}) {
  function arrayMerge(target, source, options) {
    const destination = target.slice();
    source.forEach((item, index) => {
      if (typeof destination[index] === 'undefined') {
        destination[index] = options.cloneUnlessOtherwiseSpecified(item, options);
      } else if (options.isMergeableObject(item)) {
        destination[index] = merge(target[index], item, options);
      } else if (target.indexOf(item) === -1) {
        destination.push(item);
      }
    });
    return destination;
  }
  return deepmerge(x, y, {
    arrayMerge
  });
}

function setOptions(optns) {
  options = optns;
}

function getOptions() {
  return options;
}

function isObject(val) {
  return val && typeof val === 'object' && !(val instanceof Array);
}

function toCamel(obj) {
  const reserved = isObject(obj)
    ? Object.keys(obj).reduce((acc, key) => {
        if (key[0] === '$') {
          const value = obj[key];
          delete obj[key];
          return { ...acc, [key]: value };
        }
        return acc;
      }, {})
    : null;
  const normal = normalizeKeys(obj, 'camel');
  if (reserved) {
    return { ...normal, ...reserved };
  }
  return normal;
}

function toSnake(obj) {
  if (!obj) return;
  // Make a copy to avoid mutating source object
  const objCopy = JSON.parse(JSON.stringify(obj));
  const reserved = isObject(objCopy)
    ? Object.keys(objCopy).reduce((acc, key) => {
        if (key[0] === '$') {
          const value = objCopy[key];
          delete objCopy[key];
          return { ...acc, [key]: value };
        }
        return acc;
      }, {})
    : null;
  const normal = normalizeKeys(objCopy, 'snake');
  if (reserved) {
    return { ...normal, ...reserved };
  }
  return normal;
}

function trimBoth(str) {
  return trimStart(trimEnd(str));
}

function trimStart(str) {
  return typeof str === 'string' ? str.replace(/^[/]+/, '') : '';
}

function trimEnd(str) {
  return typeof str === 'string' ? str.replace(/[/]+$/, '') : '';
}

function stringifyQuery(str) {
  return qs.stringify(str, {
    depth: 10,
    encode: false,
  });
}

function map(arr, cb) {
  return arr instanceof Array ? arr.map(cb) : [];
}

function reduce(arr, cb, init) {
  return arr instanceof Array ? arr.reduce(cb, init) : init;
}

function isServer() {
  return !(typeof window !== 'undefined' && window && window.document);
}

function isFunction(func) {
  return typeof func === 'function';
}

function defaultMethods(request, uri, methods) {
  return {
    list:
      methods.indexOf('list') >= 0
        ? function (query) {
            return request('get', uri, undefined, query);
          }
        : undefined,

    get:
      methods.indexOf('get') >= 0
        ? function (id, query) {
            return request('get', uri, id, query);
          }
        : undefined,
  };
}

async function vaultRequest(method, url, data, opt = undefined) {
  const vaultUrl = options.vaultUrl;
  const timeout = options.timeout;
  const requestId = vaultRequestId();
  const callback = `swell_vault_response_${requestId}`;

  data = {
    $jsonp: {
      method,
      callback,
    },
    $data: data,
    $key: options.key,
  };

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = `${trimEnd(vaultUrl)}/${trimStart(url)}?${serializeData(data)}`;

    const errorTimeout = setTimeout(() => {
      window[callback]({
        $error: `Request timed out after ${timeout / 1000} seconds`,
        $status: 500,
      });
    }, timeout);

    window[callback] = (result) => {
      clearTimeout(errorTimeout);
      if (result && result.$error) {
        const err = new Error(result.$error);
        err.code = 'request_error';
        err.status = result.$status;
        reject(err);
      } else if (!result || result.$status >= 300) {
        const err = new Error('A connection error occurred while making the request');
        err.code = 'connection_error';
        err.status = result.$status;
        reject(err);
      } else {
        resolve(options.useCamelCase ? toCamel(result.$data) : result.$data);
      }
      delete window[callback];
      script.parentNode.removeChild(script);
    };

    document.getElementsByTagName('head')[0].appendChild(script);
  });
}

function vaultRequestId() {
  window.__swell_vault_request_id = window.__swell_vault_request_id || 0;
  window.__swell_vault_request_id++;
  return window.__swell_vault_request_id;
}

function serializeData(data) {
  let key;
  const s = [];
  const add = function (key, value) {
    // If value is a function, invoke it and return its value
    if (typeof value === 'function') {
      value = value();
    } else if (value == null) {
      value = '';
    }
    s[s.length] = encodeURIComponent(key) + '=' + encodeURIComponent(value);
  };
  for (const key in data) {
    buildParams(key, data[key], add);
  }
  return s.join('&').replace(' ', '+');
}
const rbracket = /\[\]$/;
function buildParams(key, obj, add) {
  let name;
  if (obj instanceof Array) {
    for (let i = 0; i < obj.length; i++) {
      if (rbracket.test(key)) {
        // Treat each array item as a scalar.
        add(key, v);
      } else {
        // Item is non-scalar (array or object), encode its numeric index.
        buildParams(key + '[' + (typeof v === 'object' && v != null ? i : '') + ']', v, add);
      }
    }
  } else if (obj && typeof obj === 'object') {
    // Serialize object item.
    for (name in obj) {
      buildParams(key + '[' + name + ']', obj[name], add);
    }
  } else {
    // Serialize scalar item.
    add(key, obj);
  }
}

module.exports = {
  set,
  get,
  merge,
  setOptions,
  getOptions,
  toCamel,
  toSnake,
  trimBoth,
  trimStart,
  trimEnd,
  stringifyQuery,
  isServer,
  isFunction,
  map,
  reduce,
  defaultMethods,
  vaultRequest,
};
