import SchemaObject from "./schema_obj"
import {toHash, escapeFragment, unescapeFragment} from "./util"

var URI = require("uri-js"),
  equal = require("fast-deep-equal"),
  traverse = require("json-schema-traverse")

resolve.normalizeId = normalizeId
resolve.fullPath = getFullPath
resolve.url = resolveUrl
resolve.ids = resolveIds
resolve.inlineRef = inlineRef
resolve.schema = resolveSchema

/**
 * [resolve and compile the references ($ref)]
 * @this   Ajv
 * @param  {Function} compile reference to schema compilation funciton (localCompile)
 * @param  {Object} root object with information about the root schema for the current schema
 * @param  {String} ref reference to resolve
 * @return {Object|Function} schema object (if the schema can be inlined) or validation function
 */
function resolve(compile, root, ref) {
  /* jshint validthis: true */
  var refVal = this._refs[ref]
  if (typeof refVal == "string") {
    if (this._refs[refVal]) refVal = this._refs[refVal]
    else return resolve.call(this, compile, root, refVal)
  }

  refVal = refVal || this._schemas[ref]
  if (refVal instanceof SchemaObject) {
    return inlineRef(refVal.schema, this._opts.inlineRefs)
      ? refVal.schema
      : refVal.validate || this._compile(refVal)
  }

  var res = resolveSchema.call(this, root, ref)
  var schema, v, baseId
  if (res) {
    schema = res.schema
    root = res.root
    baseId = res.baseId
  }

  if (schema instanceof SchemaObject) {
    v = schema.validate || compile.call(this, schema.schema, root, undefined, baseId)
  } else if (schema !== undefined) {
    v = inlineRef(schema, this._opts.inlineRefs)
      ? schema
      : compile.call(this, schema, root, undefined, baseId)
  }

  return v
}

/**
 * Resolve schema, its root and baseId
 * @this Ajv
 * @param  {Object} root root object with properties schema, refVal, refs
 * @param  {String} ref  reference to resolve
 * @return {Object} object with properties schema, root, baseId
 */
function resolveSchema(root, ref) {
  /* jshint validthis: true */
  var p = URI.parse(ref),
    refPath = _getFullPath(p),
    baseId = getFullPath(root.schema.$id)
  if (Object.keys(root.schema).length === 0 || refPath !== baseId) {
    var id = normalizeId(refPath)
    var refVal = this._refs[id]
    if (typeof refVal == "string") {
      return resolveRecursive.call(this, root, refVal, p)
    } else if (refVal instanceof SchemaObject) {
      if (!refVal.validate) this._compile(refVal)
      root = refVal
    } else {
      refVal = this._schemas[id]
      if (refVal instanceof SchemaObject) {
        if (!refVal.validate) this._compile(refVal)
        if (id === normalizeId(ref)) {
          return {schema: refVal, root: root, baseId: baseId}
        }
        root = refVal
      } else {
        return
      }
    }
    if (!root.schema) return
    baseId = getFullPath(root.schema.$id)
  }
  return getJsonPointer.call(this, p, baseId, root.schema, root)
}

/* @this Ajv */
function resolveRecursive(root, ref, parsedRef) {
  /* jshint validthis: true */
  var res = resolveSchema.call(this, root, ref)
  if (res) {
    var schema = res.schema
    var baseId = res.baseId
    root = res.root
    var id = schema.$id
    if (id) baseId = resolveUrl(baseId, id)
    return getJsonPointer.call(this, parsedRef, baseId, schema, root)
  }
}

var PREVENT_SCOPE_CHANGE = toHash([
  "properties",
  "patternProperties",
  "enum",
  "dependencies",
  "definitions",
])
/* @this Ajv */
function getJsonPointer(parsedRef, baseId, schema, root) {
  /* jshint validthis: true */
  parsedRef.fragment = parsedRef.fragment || ""
  if (parsedRef.fragment.slice(0, 1) !== "/") return
  var parts = parsedRef.fragment.split("/")

  for (var i = 1; i < parts.length; i++) {
    var part = parts[i]
    if (part) {
      part = unescapeFragment(part)
      schema = schema[part]
      if (schema === undefined) break
      var id
      if (!PREVENT_SCOPE_CHANGE[part]) {
        id = schema.$id
        if (id) baseId = resolveUrl(baseId, id)
        if (schema.$ref) {
          var $ref = resolveUrl(baseId, schema.$ref)
          var res = resolveSchema.call(this, root, $ref)
          if (res) {
            schema = res.schema
            root = res.root
            baseId = res.baseId
          }
        }
      }
    }
  }
  if (schema !== undefined && schema !== root.schema) {
    return {schema: schema, root: root, baseId: baseId}
  }
}

var SIMPLE_INLINED = toHash([
  "type",
  "format",
  "pattern",
  "maxLength",
  "minLength",
  "maxProperties",
  "minProperties",
  "maxItems",
  "minItems",
  "maximum",
  "minimum",
  "uniqueItems",
  "multipleOf",
  "required",
  "enum",
])
function inlineRef(schema, limit) {
  if (limit === false) return false
  if (limit === undefined || limit === true) return checkNoRef(schema)
  else if (limit) return countKeys(schema) <= limit
}

function checkNoRef(schema) {
  var item
  if (Array.isArray(schema)) {
    for (var i = 0; i < schema.length; i++) {
      item = schema[i]
      if (typeof item == "object" && !checkNoRef(item)) return false
    }
  } else {
    for (var key in schema) {
      if (key === "$ref") return false
      item = schema[key]
      if (typeof item == "object" && !checkNoRef(item)) return false
    }
  }
  return true
}

function countKeys(schema) {
  var count = 0,
    item
  if (Array.isArray(schema)) {
    for (var i = 0; i < schema.length; i++) {
      item = schema[i]
      if (typeof item == "object") count += countKeys(item)
      if (count === Infinity) return Infinity
    }
  } else {
    for (var key in schema) {
      if (key === "$ref") return Infinity
      if (SIMPLE_INLINED[key]) {
        count++
      } else {
        item = schema[key]
        if (typeof item == "object") count += countKeys(item) + 1
        if (count === Infinity) return Infinity
      }
    }
  }
  return count
}

export function getFullPath(id: string, normalize?: boolean): string {
  if (normalize !== false) id = normalizeId(id)
  var p = URI.parse(id)
  return _getFullPath(p)
}

function _getFullPath(p) {
  return URI.serialize(p).split("#")[0] + "#"
}

var TRAILING_SLASH_HASH = /#\/?$/
export function normalizeId(id: string): string {
  return id ? id.replace(TRAILING_SLASH_HASH, "") : ""
}

export function resolveUrl(baseId: string, id: string): string {
  id = normalizeId(id)
  return URI.resolve(baseId, id)
}

/* @this Ajv */
function resolveIds(schema) {
  var schemaId = normalizeId(schema.$id)
  var baseIds = {"": schemaId}
  var fullPaths = {"": getFullPath(schemaId, false)}
  var localRefs = {}
  var self = this

  traverse(
    schema,
    {allKeys: true},
    (sch, jsonPtr, _1, parentJsonPtr, parentKeyword, _2, keyIndex) => {
      if (jsonPtr === "") return
      var id = sch.$id
      var baseId = baseIds[parentJsonPtr]
      var fullPath = fullPaths[parentJsonPtr] + "/" + parentKeyword
      if (keyIndex !== undefined) {
        fullPath += "/" + (typeof keyIndex == "number" ? keyIndex : escapeFragment(keyIndex))
      }

      if (typeof id == "string") {
        id = baseId = normalizeId(baseId ? URI.resolve(baseId, id) : id)

        var refVal = self._refs[id]
        if (typeof refVal == "string") refVal = self._refs[refVal]
        if (refVal && refVal.schema) {
          if (!equal(sch, refVal.schema)) {
            throw new Error('id "' + id + '" resolves to more than one schema')
          }
        } else if (id !== normalizeId(fullPath)) {
          if (id[0] === "#") {
            if (localRefs[id] && !equal(sch, localRefs[id])) {
              throw new Error('id "' + id + '" resolves to more than one schema')
            }
            localRefs[id] = sch
          } else {
            self._refs[id] = fullPath
          }
        }
      }
      baseIds[jsonPtr] = baseId
      fullPaths[jsonPtr] = fullPath
    }
  )

  return localRefs
}

module.exports = resolve