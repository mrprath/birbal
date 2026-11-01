// tests/mcp/geoint.test.js — GEOINT MCP tool contract tests
// WHY: Validate tool registration, schema shape, and handler contracts
// before wiring to live APIs.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../../mcp/registry.js';
import { registerGeointTools } from '../../mcp/geoint.js';

describe('GEOINT MCP tools', () => {
  let registry;

  before(() => {
    // Set env vars so handlers can read keys (values don't matter for registration)
    process.env.OPENSKY_CLIENT_ID = 'test-id';
    process.env.OPENSKY_CLIENT_SECRET = 'test-secret';
    process.env.FIRMS_MAP_KEY = 'test-key';
    process.env.TOMTOM_API_KEY = 'test-key';
    process.env.GOOGLE_MAPS_SERVER_API_KEY = 'test-key';

    registry = new ToolRegistry();
    registerGeointTools(registry);
  });

  describe('registration', () => {
    it('registers all four GEOINT tools', () => {
      const names = registry.listTools().map(t => t.name);
      assert.ok(names.includes('geoint-flights'), 'missing geoint-flights');
      assert.ok(names.includes('geoint-fires'), 'missing geoint-fires');
      assert.ok(names.includes('geoint-traffic'), 'missing geoint-traffic');
      assert.ok(names.includes('geoint-places'), 'missing geoint-places');
    });

    it('does not register duplicate tools', () => {
      const registry2 = new ToolRegistry();
      registerGeointTools(registry2);
      assert.throws(
        () => registerGeointTools(registry2),
        /already registered/,
      );
    });
  });

  describe('geoint-flights schema', () => {
    it('requires bounding box coordinates', () => {
      const tool = registry.listTools().find(t => t.name === 'geoint-flights');
      const props = tool.inputSchema.properties;
      assert.ok(props.lamin, 'missing lamin');
      assert.ok(props.lamax, 'missing lamax');
      assert.ok(props.lomin, 'missing lomin');
      assert.ok(props.lomax, 'missing lomax');
    });
  });

  describe('geoint-fires schema', () => {
    it('accepts area and day_range', () => {
      const tool = registry.listTools().find(t => t.name === 'geoint-fires');
      const props = tool.inputSchema.properties;
      assert.ok(props.area, 'missing area');
      assert.ok(props.day_range, 'missing day_range');
    });
  });

  describe('geoint-traffic schema', () => {
    it('accepts lat and lon', () => {
      const tool = registry.listTools().find(t => t.name === 'geoint-traffic');
      const props = tool.inputSchema.properties;
      assert.ok(props.lat, 'missing lat');
      assert.ok(props.lon, 'missing lon');
    });
  });

  describe('geoint-places schema', () => {
    it('accepts location and query', () => {
      const tool = registry.listTools().find(t => t.name === 'geoint-places');
      const props = tool.inputSchema.properties;
      assert.ok(props.lat, 'missing lat');
      assert.ok(props.lon, 'missing lon');
      assert.ok(props.query, 'missing query');
    });
  });

  describe('handler contracts', () => {
    it('geoint-flights returns error when API key missing', async () => {
      const saved = process.env.OPENSKY_CLIENT_ID;
      delete process.env.OPENSKY_CLIENT_ID;
      try {
        const r2 = new ToolRegistry();
        registerGeointTools(r2);
        const result = await r2.callTool('geoint-flights', {
          lamin: 40, lamax: 42, lomin: -75, lomax: -73,
        });
        assert.ok(result.includes('not configured'), result);
      } finally {
        process.env.OPENSKY_CLIENT_ID = saved;
      }
    });

    it('geoint-fires returns error when API key missing', async () => {
      const saved = process.env.FIRMS_MAP_KEY;
      delete process.env.FIRMS_MAP_KEY;
      try {
        const r2 = new ToolRegistry();
        registerGeointTools(r2);
        const result = await r2.callTool('geoint-fires', {
          area: 'world', day_range: 1,
        });
        assert.ok(result.includes('not configured'), result);
      } finally {
        process.env.FIRMS_MAP_KEY = saved;
      }
    });

    it('geoint-traffic returns error when API key missing', async () => {
      const saved = process.env.TOMTOM_API_KEY;
      delete process.env.TOMTOM_API_KEY;
      try {
        const r2 = new ToolRegistry();
        registerGeointTools(r2);
        const result = await r2.callTool('geoint-traffic', {
          lat: 40.7128, lon: -74.006,
        });
        assert.ok(result.includes('not configured'), result);
      } finally {
        process.env.TOMTOM_API_KEY = saved;
      }
    });

    it('geoint-places returns error when API key missing', async () => {
      const saved = process.env.GOOGLE_MAPS_SERVER_API_KEY;
      delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
      try {
        const r2 = new ToolRegistry();
        registerGeointTools(r2);
        const result = await r2.callTool('geoint-places', {
          lat: 40.7128, lon: -74.006, query: 'coffee',
        });
        assert.ok(result.includes('not configured'), result);
      } finally {
        process.env.GOOGLE_MAPS_SERVER_API_KEY = saved;
      }
    });
  });
});
