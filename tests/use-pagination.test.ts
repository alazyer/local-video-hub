import { describe, expect, test } from "bun:test";
import {
  clampPage,
  computePageCount,
  slicePage,
} from "../src/hooks/use-pagination";

describe("computePageCount", () => {
  test("空数组至少 1 页", () => {
    expect(computePageCount(0, 50)).toBe(1);
  });

  test("不足一页算 1 页", () => {
    expect(computePageCount(49, 50)).toBe(1);
    expect(computePageCount(1, 50)).toBe(1);
  });

  test("恰好整除", () => {
    expect(computePageCount(50, 50)).toBe(1);
    expect(computePageCount(100, 50)).toBe(2);
    expect(computePageCount(200, 100)).toBe(2);
  });

  test("非整数向上取整", () => {
    expect(computePageCount(51, 50)).toBe(2);
    expect(computePageCount(99, 50)).toBe(2);
    expect(computePageCount(101, 100)).toBe(2);
    expect(computePageCount(250, 100)).toBe(3);
  });

  test("pageSize 非法时退化为 1 页", () => {
    expect(computePageCount(500, 0)).toBe(1);
    expect(computePageCount(500, -1)).toBe(1);
  });
});

describe("clampPage", () => {
  test("下限为 1", () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(-3, 5)).toBe(1);
  });

  test("上限为 pageCount", () => {
    expect(clampPage(6, 5)).toBe(5);
    expect(clampPage(999, 5)).toBe(5);
  });

  test("区间内不变", () => {
    expect(clampPage(1, 5)).toBe(1);
    expect(clampPage(3, 5)).toBe(3);
    expect(clampPage(5, 5)).toBe(5);
  });

  test("pageCount 为 1 时始终 1", () => {
    expect(clampPage(10, 1)).toBe(1);
    expect(clampPage(0, 1)).toBe(1);
  });
});

describe("slicePage", () => {
  const items = Array.from({ length: 120 }, (_, i) => i);

  test("第 1 页返回前 pageSize 项", () => {
    expect(slicePage(items, 1, 50)).toEqual(items.slice(0, 50));
  });

  test("中间页", () => {
    expect(slicePage(items, 2, 50)).toEqual(items.slice(50, 100));
  });

  test("末页返回剩余项（不足一页）", () => {
    expect(slicePage(items, 3, 50)).toEqual(items.slice(100, 120));
  });

  test("越界页码自动夹取到末页", () => {
    expect(slicePage(items, 99, 50)).toEqual(items.slice(100, 120));
  });

  test("页码 < 1 夹取到第 1 页", () => {
    expect(slicePage(items, 0, 50)).toEqual(items.slice(0, 50));
    expect(slicePage(items, -5, 50)).toEqual(items.slice(0, 50));
  });

  test("空数组返回空切片", () => {
    expect(slicePage([], 1, 50)).toEqual([]);
    expect(slicePage([], 5, 50)).toEqual([]);
  });

  test("恰好整除时末页为完整一页", () => {
    const full = Array.from({ length: 100 }, (_, i) => i);
    expect(slicePage(full, 2, 50)).toEqual(full.slice(50, 100));
    // 第 3 页不存在（共 2 页），夹取回末页
    expect(slicePage(full, 3, 50)).toEqual(full.slice(50, 100));
  });
});
