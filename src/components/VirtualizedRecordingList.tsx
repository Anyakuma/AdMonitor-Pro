/**
 * Virtualized Recording List Component
 * Only renders visible items, dramatically improves performance with 500+ recordings
 */

import React, { useMemo, useCallback, useState } from 'react';
// @ts-ignore - react-window types have issues
import { FixedSizeList as List } from 'react-window';
import type { Recording } from '../services/recordingService';
import RecordingListItem from './RecordingListItem';

interface VirtualizedRecordingListProps {
  recordings: Recording[];
  selectedRecs: Set<string>;
  playingId: string | null;
  playProgress: Record<string, number>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onDeleteRecording: (id: string) => void;
  onPlayClick: (id: string) => void;
  onTimeUpdate: (id: string, progress: number) => void;
  onPlayEnd: (id: string) => void;
}

const Row = React.memo(({
  index,
  style,
  data,
}: {
  index: number;
  style: React.CSSProperties;
  data: {
    recordings: Recording[];
    selectedRecs: Set<string>;
    playingId: string | null;
    playProgress: Record<string, number>;
    callbacks: {
      onToggleSelect: (id: string) => void;
      onDeleteRecording: (id: string) => void;
      onPlayClick: (id: string) => void;
      onTimeUpdate: (id: string, progress: number) => void;
      onPlayEnd: (id: string) => void;
    };
  };
}) => {
  const rec = data.recordings[index];
  if (!rec) return null;

  return (
    <div style={style}>
      <RecordingListItem
        rec={rec}
        isSelected={data.selectedRecs.has(rec.id)}
        isPlaying={data.playingId === rec.id}
        progress={data.playProgress[rec.id] || 0}
        onToggleSelect={() => data.callbacks.onToggleSelect(rec.id)}
        onDelete={() => data.callbacks.onDeleteRecording(rec.id)}
        onPlayClick={() => data.callbacks.onPlayClick(rec.id)}
        onTimeUpdate={(p) => data.callbacks.onTimeUpdate(rec.id, p)}
        onPlayEnd={() => data.callbacks.onPlayEnd(rec.id)}
      />
    </div>
  );
});
Row.displayName = 'VirtualizedRecordingRow';

/**
 * Main virtualized list component
 */
export const VirtualizedRecordingList = React.memo(({
  recordings,
  selectedRecs,
  playingId,
  playProgress,
  onToggleSelect,
  onToggleAll,
  onDeleteRecording,
  onPlayClick,
  onTimeUpdate,
  onPlayEnd,
}: VirtualizedRecordingListProps) => {
  // Item height should match RecordingListItem rendering height
  const ITEM_HEIGHT = 120; // Adjust based on actual rendered height

  const itemData = useMemo(
    () => ({
      recordings,
      selectedRecs,
      playingId,
      playProgress,
      callbacks: {
        onToggleSelect,
        onDeleteRecording,
        onPlayClick,
        onTimeUpdate,
        onPlayEnd,
      },
    }),
    [recordings, selectedRecs, playingId, playProgress, onToggleSelect, onDeleteRecording, onPlayClick, onTimeUpdate, onPlayEnd]
  );

  return (
    <div style={{ height: 'calc(100% - 0px)', width: '100%' }}>
      <List
        height={400} // Will use parent container height
        itemCount={recordings.length}
        itemSize={ITEM_HEIGHT}
        width={'100%' as any}
        itemData={itemData}
      >
        {Row}
      </List>
    </div>
  );
});

VirtualizedRecordingList.displayName = 'VirtualizedRecordingList';

export default VirtualizedRecordingList;
