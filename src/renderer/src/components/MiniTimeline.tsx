import type { JSX } from 'react'
import type { TrackSummary, TrackType } from '@shared/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'

const TRACK_COLORS: Record<TrackType, string> = {
  video: 'bg-track-video',
  audio: 'bg-track-audio',
  text: 'bg-track-text',
  sticker: 'bg-track-sticker',
  effect: 'bg-track-effect',
  filter: 'bg-track-effect',
  adjust: 'bg-track-effect'
}

const TRACK_LABELS: Record<TrackType, string> = {
  video: 'Video',
  audio: 'Audio',
  text: 'Text',
  sticker: 'Sticker',
  effect: 'Effect',
  filter: 'Filter',
  adjust: 'Adjust'
}

interface MiniTimelineProps {
  tracks: TrackSummary[]
  durationUs: number
}

/** Read-only scaled visualization of the project's tracks and segments. */
export function MiniTimeline({ tracks, durationUs }: MiniTimelineProps): JSX.Element {
  if (durationUs <= 0 || tracks.length === 0) {
    return <div className="text-xs text-muted-foreground">No timeline data</div>
  }

  return (
    <div className="flex flex-col gap-1.5">
      {tracks.map((track, trackIndex) => (
        <div key={trackIndex} className="flex items-center gap-2">
          <div className="w-12 shrink-0 text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            {TRACK_LABELS[track.type]}
          </div>
          <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-foreground/[0.06]">
            {track.segments.map((segment, segmentIndex) => {
              const left = (segment.startUs / durationUs) * 100
              const width = Math.max((segment.durationUs / durationUs) * 100, 0.75)
              return (
                <Tooltip key={segmentIndex}>
                  <TooltipTrigger
                    render={
                      <div
                        className={cn(
                          'absolute top-0.5 bottom-0.5 rounded-[5px] opacity-90 transition-opacity hover:opacity-100',
                          TRACK_COLORS[track.type]
                        )}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                    }
                  />
                  <TooltipContent side="top" className="max-w-60">
                    <div className="truncate text-xs">
                      {segment.label ?? TRACK_LABELS[track.type]}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {formatDuration(segment.startUs)} · {formatDuration(segment.durationUs)} long
                    </div>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </div>
      ))}
      <div className="mt-0.5 flex justify-between pl-14 text-[10px] text-muted-foreground tabular-nums">
        <span>0:00</span>
        <span>{formatDuration(durationUs)}</span>
      </div>
    </div>
  )
}
