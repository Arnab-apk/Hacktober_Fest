/**
 * VirtualizedFileList — High-performance virtualized list for large file collections.
 * Only renders visible items for optimal performance with 1000+ files.
 */

import React, { CSSProperties } from 'react';
import { List } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';

interface VirtualizedFileListProps<T> {
  items: T[];
  itemHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
}

interface RowProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
}

function VirtualizedRow<T>({
  index,
  style,
  items,
  renderItem,
}: {
  index: number;
  style: CSSProperties;
} & RowProps<T>) {
  return (
    <div style={style}>
      {renderItem(items[index], index)}
    </div>
  );
}

export function VirtualizedFileList<T>({
  items,
  itemHeight,
  renderItem,
  className = '',
}: VirtualizedFileListProps<T>) {
  return (
    <div className={`${className} h-full`}>
      <AutoSizer
        renderProp={({ height, width }) => (
          <List
            style={{ height: height ?? '100%', width: width ?? '100%' }}
            rowCount={items.length}
            rowHeight={itemHeight}
            rowComponent={VirtualizedRow as any}
            rowProps={{ items, renderItem }}
            overscanCount={5}
          />
        )}
      />
    </div>
  );
}
