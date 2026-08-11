"use client";

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
} from "@/components/ui/pagination";

interface PagerBarProps {
  /** 当前页（从 1 开始） */
  page: number;
  /** 总页数；为 null 表示未知（仅显示“第 X 页”） */
  pageCount: number | null;
  /** 是否有上一页 */
  hasPrev: boolean;
  /** 是否有下一页 */
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * 通用上一页/下一页分页栏。
 *
 * `pagination.tsx` 的 PaginationLink 渲染的是 `<a>`，这里通过 spread props
 * 注入 `onClick`（阻止默认跳转）与 `role="button"`，以适配 SPA 行为；
 * 组件本身不修改。
 */
export function PagerBar({
  page,
  pageCount,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: PagerBarProps) {
  const label =
    pageCount == null
      ? `第 ${page} 页`
      : pageCount <= 1
        ? null
        : `第 ${page}/${pageCount} 页`;

  const handlePrev = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (hasPrev) onPrev();
  };
  const handleNext = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (hasNext) onNext();
  };

  return (
    <Pagination className="justify-center py-1">
      <PaginationContent className="gap-1">
        <PaginationItem>
          <PaginationPrevious
            href="#"
            role="button"
            aria-disabled={!hasPrev}
            tabIndex={hasPrev ? 0 : -1}
            onClick={handlePrev}
            className={hasPrev ? "" : "pointer-events-none opacity-40"}
          />
        </PaginationItem>
        {label && (
          <PaginationItem>
            <span className="text-xs text-muted-foreground px-2 select-none whitespace-nowrap">
              {label}
            </span>
          </PaginationItem>
        )}
        <PaginationItem>
          <PaginationNext
            href="#"
            role="button"
            aria-disabled={!hasNext}
            tabIndex={hasNext ? 0 : -1}
            onClick={handleNext}
            className={hasNext ? "" : "pointer-events-none opacity-40"}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
