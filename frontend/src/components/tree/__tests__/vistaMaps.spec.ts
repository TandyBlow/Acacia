import { describe, it, expect } from 'vitest';
import { backgroundFragmentShader } from '../shaders/backgroundRaymarch';

describe('ARCH-01: Vista map .glsl file extraction', () => {
  it('all .glsl files are importable via Vite ?raw', () => {
    const modules = import.meta.glob('../shaders/vista/*.glsl', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const files = Object.keys(modules);
    expect(files.length).toBe(4);
    for (const [path, content] of Object.entries(modules)) {
      expect(typeof content).toBe('string');
      expect((content as string).length).toBeGreaterThan(200);
    }
  });

  it('each .glsl file contains exactly one map function definition', () => {
    const modules = import.meta.glob('../shaders/vista/*.glsl', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const expected = ['mapDefault', 'mapSakura', 'mapCyberpunk', 'mapInk'];
    for (const name of expected) {
      const key = Object.keys(modules).find((k) =>
        k.toLowerCase().includes(name.toLowerCase()),
      );
      expect(key, `Missing .glsl file for ${name}`).toBeDefined();
      const content = modules[key!] as string;
      expect(content).toMatch(new RegExp(`float ${name}\\(vec3 p\\)`));
    }
  });

  it('backgroundFragmentShader contains all 4 map function names', () => {
    expect(backgroundFragmentShader).toMatch(/mapDefault/);
    expect(backgroundFragmentShader).toMatch(/mapSakura/);
    expect(backgroundFragmentShader).toMatch(/mapCyberpunk/);
    expect(backgroundFragmentShader).toMatch(/mapInk/);
  });
});
