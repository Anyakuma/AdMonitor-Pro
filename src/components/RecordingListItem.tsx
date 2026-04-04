/**
 * Optimized Recording List Item
 * Memoized to prevent re-renders unless props change
 */

import React, { useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Play, Download, Trash2, CheckSquare, Clock, Activity, AudioLines } from 'lucide-react';
import { format } from 'date-fns';
import type { Recording} from '../services/recordingService';
import type { Confidence } from '../services/detectionService';

interface RecordingListItemProps {
  rec: Recording;
  isSelected: boolean;
  isPlaying: boolean;
  progress: number;
  onToggleSelect: () => void;
  onDelete: () => void;
  onPlayClick: () => void;
  onTimeUpdate: (progress: number) => void;
  onPlayEnd: () => void;
}

const confColor = (c?: string) =>
  c === 'Strong' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' :
    c === 'Good' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400' :
      'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400';

const SquareIcon = ({ size = 24, className = '' }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
  </svg>
);

/**
 * Individual recording item - memoized to prevent re-renders
 */
const RecordingListItemComponent = ({
  rec,
  isSelected,
  isPlaying,
  progress,
  onToggleSelect,
  onDelete,
  onPlayClick,
  onTimeUpdate,
  onPlayEnd,
}: RecordingListItemProps) => {
  // Download handler - wrapped in useCallback to maintain referential equality
  const handleDownload = useCallback(() => {
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ad_${rec.triggerWord}_${rec.id}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [rec.blob, rec.triggerWord, rec.id]);

  // Audio element callback
  const handleTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLAudioElement>) => {
    const el = e.currentTarget;
    if (el.duration) {
      onTimeUpdate(el.currentTime / el.duration);
    }
  }, [onTimeUpdate]);

  return (
    <motion.div
      layout
      // Disable enter/exit animations for better virtualization performance
      className={`group bg-zinc-900 border ${isSelected ? 'border-blue-500/40' : 'border-zinc-800 hover:border-zinc-700'} rounded-xl p-3 sm:p-4 transition-colors`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3">
        {/* Select checkbox */}
        <button
          onClick={onToggleSelect}
          className="text-zinc-700 hover:text-blue-500 shrink-0 transition-colors"
        >
          {isSelected ? (
            <CheckSquare size={16} className="text-blue-500" />
          ) : (
            <SquareIcon size={16} />
          )}
        </button>

        {/* Play button */}
        <button
          onClick={onPlayClick}
          className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${isPlaying ? 'bg-blue-600 text-white' : 'bg-zinc-800 border border-zinc-700 text-zinc-400 hover:border-blue-500/50 hover:text-blue-400'}`}
        >
          {isPlaying ? (
            <SquareIcon size={13} className="fill-current" />
          ) : (
            <Play size={15} className="ml-0.5 fill-current" />
          )}
        </button>

        {/* Recording info */}
        <div className="flex-1 min-w-0 w-full">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-semibold text-blue-400 truncate">
              {rec.triggerWord}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${confColor(rec.confidence)}`}>
              {rec.confidence}
            </span>
            {rec.voteScore > 0 && (
              <span className="mono text-[10px] text-zinc-600 whitespace-nowrap">
                {(rec.voteScore * 100).toFixed(0)}%
              </span>
            )}
          </div>

          {rec.transcript && (
            <p className="text-xs text-zinc-600 truncate mb-1 italic">
              {rec.transcript}
            </p>
          )}

          <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3 text-xs text-zinc-600">
            <span className="flex items-center gap-1 whitespace-nowrap">
              <Clock size={11} />
              {format(rec.timestamp, 'MMM d, h:mm a')}
            </span>
            <span className="flex items-center gap-1 text-zinc-500 whitespace-nowrap">
              <Activity size={11} />
              <span className="mono text-[9px]">30s pre</span>
              <span className="text-red-500/70 mono">▲</span>
              <span className="mono text-[9px]">
                +{Math.max(0, rec.duration - 30).toFixed(0)}s
              </span>
            </span>
            <span className="flex items-center gap-1 whitespace-nowrap">
              <AudioLines size={11} />
              {(rec.blob.size / 1024).toFixed(0)}KB
            </span>
          </div>

          {/* Progress bar */}
          {isPlaying && (
            <div className="mt-2 h-0.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 self-center opacity-100 transition-opacity">
          <button
            onClick={handleDownload}
            className="p-2 text-zinc-600 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
            title="Download"
          >
            <Download size={15} />
          </button>
          <button
            onClick={onDelete}
            className="p-2 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            title="Delete"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Hidden audio element - only rendered when needed */}
      <audio
        src={rec.url}
        className="hidden"
        onTimeUpdate={handleTimeUpdate}
        onEnded={onPlayEnd}
      />
    </motion.div>
  );
};

RecordingListItemComponent.displayName = 'RecordingListItem';

/**
 * Export memoized version
 * Only re-renders if any prop changes
 */
export default React.memo(RecordingListItemComponent, (prevProps, nextProps) => {
  // Custom comparison for better performance
  return (
    prevProps.rec.id === nextProps.rec.id &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isPlaying === nextProps.isPlaying &&
    prevProps.progress === nextProps.progress &&
    prevProps.onToggleSelect === nextProps.onToggleSelect &&
    prevProps.onDelete === nextProps.onDelete &&
    prevProps.onPlayClick === nextProps.onPlayClick &&
    prevProps.onTimeUpdate === nextProps.onTimeUpdate &&
    prevProps.onPlayEnd === nextProps.onPlayEnd
  );
});
