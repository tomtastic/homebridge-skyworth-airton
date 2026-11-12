import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const configSchema = JSON.parse(
  readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8'),
);

/**
 * Visit every schema node, so the checks below can look at `required` wherever
 * it appears. The path is only there to name an offending node in a failure.
 */
function visit(schema, visitPath, each) {
  if (schema === null || typeof schema !== 'object') {
    return;
  }
  each(schema, visitPath);
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [name, child] of Object.entries(schema.properties)) {
      visit(child, `${visitPath}.${name}`, each);
    }
  }
  const items = Array.isArray(schema.items) ? schema.items : [schema.items];
  for (const item of items) {
    visit(item, `${visitPath}[]`, each);
  }
}

test('no schema field marks itself required', () => {
  // `required` is an array on the object that owns the properties; a boolean on
  // a field is not JSON Schema. AJV refuses to compile a config.schema.json
  // that does that, and the Homebridge plugin verification check runs AJV over
  // the schema, so the whole request fails on it.
  const offenders = [];
  visit(configSchema.schema, 'schema', (node, nodePath) => {
    if (typeof node.required === 'boolean') {
      offenders.push(nodePath);
    }
  });
  assert.deepEqual(offenders, []);
});

test('every required name is a property of its own object', () => {
  // A name that no property defines is silently ignored, which would leave a
  // field the plugin needs optional.
  const offenders = [];
  visit(configSchema.schema, 'schema', (node, nodePath) => {
    if (!Array.isArray(node.required)) {
      return;
    }
    for (const name of node.required) {
      if (!Object.hasOwn(node.properties ?? {}, name)) {
        offenders.push(`${nodePath} requires "${name}"`);
      }
    }
  });
  assert.deepEqual(offenders, []);
});

test('the fields the plugin cannot work without are required', () => {
  const platform = configSchema.schema;
  assert.deepEqual(platform.required, ['name', 'devices']);
  assert.equal(platform.properties.devices.minItems, 1);
  assert.deepEqual(platform.properties.devices.items.required, ['name', 'host']);
});
