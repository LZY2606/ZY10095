import { describe, expect, it } from "vitest";
import { canonicalJson, fingerprint, sha256Hex } from "../src/core/hash";

describe("canonicalJson", () => {
  it("键顺序不影响输出", () => {
    const a = canonicalJson({ z: 1, a: { y: 2, x: 3 } });
    const b = canonicalJson({ a: { x: 3, y: 2 }, z: 1 });
    expect(a).toBe(b);
  });

  it("数组顺序保持有意义", () => {
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it("省略 undefined 与空", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("sha256Hex", () => {
  it("匹配 FIPS 已知向量", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("长输入（跨块）一致", () => {
    const value = "a".repeat(200);
    expect(sha256Hex(value)).toBe(sha256Hex(value));
  });
});

describe("fingerprint", () => {
  it("同一内容同一指纹，遍历顺序无关", () => {
    expect(fingerprint({ a: [1, 2], b: { x: 1 } })).toBe(fingerprint({ b: { x: 1 }, a: [1, 2] }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});
