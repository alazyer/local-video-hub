"use client";

import { useCallback, useMemo, useState } from "react";

export interface UsePaginationResult<T> {
  /** 当前页码（从 1 开始） */
  page: number;
  /** 每页条数 */
  pageSize: number;
  /** 总页数（向上取整，最小 1） */
  pageCount: number;
  /** 当前页的数据切片 */
  paginatedItems: T[];
  /** 总条数（items.length） */
  total: number;
  /** 跳转到指定页（自动夹取到 [1, pageCount]） */
  setPage: (p: number) => void;
  /** 下一页，到末页后不再前进 */
  nextPage: () => void;
  /** 上一页，到首页后不再前进 */
  prevPage: () => void;
  /** 重置到第 1 页（在搜索/排序/目录切换时调用） */
  reset: () => void;
}

/**
 * 计算总页数（向上取整，至少 1 页）。
 * 导出以便单测覆盖边界（空数组、恰好整除、非整数等）。
 */
export function computePageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** 将页码夹取到 [1, pageCount]。 */
export function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(1, page), pageCount);
}

/** 返回指定页的数据切片（page 从 1 开始）。 */
export function slicePage<T>(
  items: T[],
  page: number,
  pageSize: number,
): T[] {
  const start = (clampPage(page, computePageCount(items.length, pageSize)) - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

/**
 * 客户端分页 hook —— 集中管理页码状态并对 items 做切片。
 *
 * 行为约定：
 *  - 对「过滤后的结果」分页：传入 items 即 filtered useMemo 的输出。
 *  - items 引用变化（搜索/排序/源数据变更）时自动重置到第 1 页。
 *  - 页码自动夹取：当 items 变少（例如筛选后）使当前页越界时回退到末页。
 *  - 控件可见性由调用方决定：`total <= pageSize` 时不渲染分页栏。
 *
 * 页码校正（重置 / 越界回退）采用「渲染期间调整 state」模式
 * （https://react.dev/reference/react/useState#storing-information-from-previous-renders），
 * 避免在 effect 中 setState，符合 react-hooks 规则。
 */
export function usePagination<T>(
  items: T[],
  pageSize: number,
): UsePaginationResult<T> {
  const [page, setPageState] = useState(1);
  // 记录上一次渲染依赖的 items 引用与 pageCount，用于检测变化
  const [prevItems, setPrevItems] = useState(items);
  const [prevPageCount, setPrevPageCount] = useState(1);

  const total = items.length;
  const pageCount = useMemo(
    () => computePageCount(total, pageSize),
    [total, pageSize],
  );

  // 渲染期间校正页码：
  //  1) items 引用变化（搜索/排序/目录切换）→ 重置到第 1 页
  //  2) 当前页越界（items 变少）→ 回退到末页
  let effectivePage = page;
  if (prevItems !== items) {
    effectivePage = 1;
    setPrevItems(items);
  } else if (page > pageCount) {
    effectivePage = pageCount;
  }
  if (prevPageCount !== pageCount) {
    setPrevPageCount(pageCount);
  }

  const setPage = useCallback(
    (p: number) => {
      setPageState(clampPage(p, pageCount));
    },
    [pageCount],
  );

  const nextPage = useCallback(() => {
    setPageState((p) => clampPage(p + 1, pageCount));
  }, [pageCount]);

  const prevPage = useCallback(() => {
    setPageState((p) => clampPage(p - 1, pageCount));
  }, [pageCount]);

  const reset = useCallback(() => {
    setPageState(1);
  }, []);

  const paginatedItems = useMemo(
    () => slicePage(items, effectivePage, pageSize),
    [items, effectivePage, pageSize],
  );

  return {
    page: effectivePage,
    pageSize,
    pageCount,
    paginatedItems,
    total,
    setPage,
    nextPage,
    prevPage,
    reset,
  };
}
