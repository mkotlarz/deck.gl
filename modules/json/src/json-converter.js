// Converts JSON to props ("hydrating" classes, resolving enums and functions etc).
// Lightly processes `json` props, transform string values, and extract `views` and `layers`
// See: https://github.com/uber/deck.gl/blob/master/dev-docs/RFCs/v6.1/json-layers-rfc.md
//
// NOTES:
// * This is intended to provide minimal necessary processing required to support
//   existing deck.gl props via JSON. This is not an implementation of alternate JSON schemas.
// * Optionally, error checking could be applied, but ideally should leverage
//   non-JSON specific mechanisms like prop types.

import assert from './utils/assert';
import JSONConfiguration from './json-configuration';
import {instantiateClass} from './helpers/instantiate-class';
import parseJSON from './helpers/parse-json';

const isObject = value => value && typeof value === 'object';
const FUNCTION_IDENTIFIER = '@@=';
const CONSTANT_IDENTIFIER = '@@#';

export default class JSONConverter {
  constructor(props) {
    this.log = console; // eslint-disable-line
    this.configuration = {};
    this.onJSONChange = () => {};
    this.json = null;
    this.convertedJson = null;
    this.setProps(props);
  }

  finalize() {}

  setProps(props) {
    // HANDLE CONFIGURATION PROPS
    if ('configuration' in props) {
      // Accept object or `JSONConfiguration`
      this.configuration =
        props.configuration instanceof JSONConfiguration
          ? props.configuration
          : new JSONConfiguration(props.configuration);
    }

    if ('onJSONChange' in props) {
      this.onJSONChange = props.onJSONChange;
    }
  }

  convert(json) {
    // Use shallow equality to ensure we only convert same json once
    if (!json || json === this.json) {
      return this.convertedJson;
    }
    // Save json for shallow diffing
    this.json = json;

    // Accept JSON strings by parsing them
    const parsedJSON = parseJSON(json);

    // Convert the JSON
    let convertedJson = convertJSON(parsedJSON, this.configuration);

    convertedJson = this.configuration.postProcessConvertedJson(convertedJson);

    this.convertedJson = convertedJson;
    return convertedJson;
  }

  // DEPRECATED: Backwards compatibility
  convertJson(json) {
    return this.convert(json);
  }
}

function convertJSON(json, configuration) {
  // Fixup configuration
  configuration = new JSONConfiguration(configuration);
  return convertJSONRecursively(json, '', configuration);
}

// Converts JSON to props ("hydrating" classes, resolving enums and functions etc).
function convertJSONRecursively(json, key, configuration) {
  if (Array.isArray(json)) {
    return json.map((element, i) => convertJSONRecursively(element, String(i), configuration));
  }

  // If object.type is in configuration, instantitate
  if (isClassInstance(json, configuration)) {
    return convertClassInstance(json, configuration);
  }

  if (isObject(json)) {
    return convertPlainObject(json, configuration);
  }

  // Single value
  if (typeof json === 'string') {
    return convertString(json, key, configuration);
  }

  // Return unchanged (number, boolean, ...)
  return json;
}

// Returns true if an object has a `type` field
function isClassInstance(json, configuration) {
  const {typeKey} = configuration;
  return isObject(json) && Boolean(json[typeKey]);
}

function convertClassInstance(json, configuration) {
  // Extract the class type field
  const {typeKey} = configuration;
  const type = json[typeKey];

  // Prepare a props object and ensure all values have been converted
  let props = {...json};
  delete props[typeKey];

  props = convertPlainObject(props, configuration);

  return instantiateClass(type, props, configuration);
}

// Plain JS object, convert each key and return.
function convertPlainObject(json, configuration) {
  assert(isObject(json));

  const result = {};
  for (const key in json) {
    const value = json[key];
    result[key] = convertJSONRecursively(value, key, configuration);
  }
  return result;
}

// Convert one string value in an object
// TODO - We could also support string syntax for hydrating other types, like regexps...
// But no current use case
function convertString(string, key, configuration) {
  // Here the JSON value is supposed to be treated as a function
  if (string.startsWith(FUNCTION_IDENTIFIER) && configuration.convertFunction) {
    string = string.replace(FUNCTION_IDENTIFIER, '');
    return configuration.convertFunction(string, key, configuration);
  }
  if (string.startsWith(CONSTANT_IDENTIFIER)) {
    string = string.replace(CONSTANT_IDENTIFIER, '');
    if (configuration.constants[string]) {
      return configuration.constants[string];
    }
    // enum
    const [enumVarName, enumValName] = string.split('.');
    return configuration.enumerations[enumVarName][enumValName];
  }
  return string;
}
