/**
 * Synthetic CapCut fixture factory.
 *
 * Creates fake "machines" (home directories with a CapCut layout) and drafts
 * whose JSON mirrors the real schema we verified on CapCut 8.7 (macOS) and on
 * real Windows-authored drafts (3.9/8.5): placeholder media paths, effect-cache
 * absolute paths, platform blocks, registry, meta materials, etc.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { DRAFT_PATH_PLACEHOLDER } from '../../src/main/core/capcut/constants'

export const MAC_TIMELINE_ID = '2E73B255-11A1-4C40-9D33-9F0E10C908DD'
export const MAC_META_DRAFT_ID = 'FCB79876-BED0-4EA2-B28D-E876D380A0BA'

/** Smallest well-formed JPEG (1×1, gray). Enough for cover round-trips. */
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
  'base64'
)

function write(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
}

function writeJson(path: string, value: unknown): void {
  write(path, JSON.stringify(value))
}

// --- Machines ---------------------------------------------------------------

export interface FakeMacMachine {
  os: 'mac'
  homeDir: string
  userDataDir: string
  draftRoot: string
  cacheDir: string
  /** The sandbox-container cache spelling CapCut writes into JSON. */
  containerCacheDir: string
}

/** Lays out a fake macOS home with the CapCut directory structure. */
export function makeMacMachine(tmpDir: string): FakeMacMachine {
  const homeDir = join(tmpDir, 'machome')
  const userDataDir = join(homeDir, 'Movies', 'CapCut', 'User Data')
  const draftRoot = join(userDataDir, 'Projects', 'com.lveditor.draft')
  const cacheDir = join(userDataDir, 'Cache')
  mkdirSync(draftRoot, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })
  return {
    os: 'mac',
    homeDir,
    userDataDir,
    draftRoot,
    cacheDir,
    containerCacheDir: join(
      homeDir,
      'Library/Containers/com.lemon.lvoverseas/Data/Movies/CapCut/User Data/Cache'
    )
  }
}

export interface FakeWinMachine {
  os: 'windows'
  homeDir: string
  localAppData: string
  userDataDir: string
  draftRoot: string
  cacheDir: string
}

/** Lays out a fake Windows home (paths are real temp dirs; separators stay '/'). */
export function makeWinMachine(tmpDir: string): FakeWinMachine {
  const homeDir = join(tmpDir, 'winhome')
  const localAppData = join(homeDir, 'AppData', 'Local')
  const userDataDir = join(localAppData, 'CapCut', 'User Data')
  const draftRoot = join(userDataDir, 'Projects', 'com.lveditor.draft')
  const cacheDir = join(userDataDir, 'Cache')
  mkdirSync(draftRoot, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })
  return { os: 'windows', homeDir, localAppData, userDataDir, draftRoot, cacheDir }
}

// --- Draft creation ----------------------------------------------------------

export interface CreateDraftOptions {
  name?: string
  /**
   * Loose media: absolute paths recorded in the draft JSON as media that was
   * NOT copied into the draft ("copy materials to draft" off). Files are
   * created on disk so the exporter can bundle them.
   */
  looseMediaDir?: string
  /** Microsecond timestamps; fixed defaults keep tests deterministic. */
  createUs?: number
  modifiedUs?: number
}

export interface CreatedDraft {
  folder: string
  name: string
  timelineId: string
  metaDraftId: string
  timelineFilename: string
  /** Effect-cache files created under the machine's cache dir (suffix form). */
  cacheSuffixes: string[]
  /** Absolute loose media paths referenced by the draft (created on disk). */
  looseMediaPaths: string[]
  localMedia: { fileName: string; bytes: Buffer }[]
}

const PLACEHOLDER = DRAFT_PATH_PLACEHOLDER

function platformBlock(os: 'mac' | 'windows', appVersion: string): Record<string, unknown> {
  return {
    app_id: 359289,
    app_source: 'cc',
    app_version: appVersion,
    device_id: 'c4ca4238a0b923820dcc509a6f75849b',
    hard_disk_id: '',
    mac_address: '9c022ddb057a49aa2d0bbc9d0586c953',
    os,
    os_version: os === 'mac' ? '26.4' : '10.0.26200'
  }
}

/**
 * Creates a mac-flavored draft on a fake mac machine, including:
 * placeholder media in Resources/local, effect-cache paths in the JSON with
 * matching files in the machine's cache dir, a text material, a regenerable
 * matting/ cache, volatile .bak/template files, and a registry entry.
 */
export function createMacDraft(
  machine: FakeMacMachine,
  opts: CreateDraftOptions = {}
): CreatedDraft {
  const name = opts.name ?? 'Fixture Project'
  const folder = join(machine.draftRoot, name)
  const createUs = opts.createUs ?? 1780756859388099
  const modifiedUs = opts.modifiedUs ?? 1780765223363020

  const containerCacheJson = machine.containerCacheDir.split('\\').join('/')

  // Local (copied) media files.
  const localMedia = [
    { fileName: '1ea7778f132da493c57bc82ba2a21317.mp4', bytes: Buffer.from('fake-video-1-bytes') },
    { fileName: '9343d313009f0d04fe1a39aa446c8075.mp3', bytes: Buffer.from('fake-audio-1-bytes') }
  ]
  for (const media of localMedia) {
    write(join(folder, 'Resources', 'local', media.fileName), media.bytes)
  }

  // Effect-cache assets present on this machine.
  const cacheSuffixes = [
    'effect/7428434762538192134/981280af790e952a04980057b401',
    'artistEffect/7256860510790995206/929c891b192cb9be93005542c79d'
  ]
  for (const suffix of cacheSuffixes) {
    write(join(machine.cacheDir, ...suffix.split('/')), Buffer.from(`cache:${suffix}`))
  }

  // Loose media (optional): lives OUTSIDE the draft folder.
  const looseMediaPaths: string[] = []
  if (opts.looseMediaDir) {
    const loosePath = join(opts.looseMediaDir, 'b-roll clip.mp4')
    write(loosePath, Buffer.from('loose-broll-bytes'))
    looseMediaPaths.push(loosePath)
  }

  const videos: Record<string, unknown>[] = [
    {
      id: 'A1000000-0000-0000-0000-000000000001',
      type: 'video',
      material_name: 'clip-one.mp4',
      path: `${PLACEHOLDER}/Resources/local/${localMedia[0].fileName}`,
      media_path: '',
      local_material_id: 'fbd08766-03e1-460f-bbb0-49461ae57b1c',
      width: 1080,
      height: 1920
    }
  ]
  if (looseMediaPaths.length > 0) {
    videos.push({
      id: 'A1000000-0000-0000-0000-000000000002',
      type: 'video',
      material_name: 'b-roll clip.mp4',
      path: looseMediaPaths[0].split('\\').join('/'),
      media_path: '',
      local_material_id: '',
      width: 1920,
      height: 1080
    })
  }

  const timeline: Record<string, unknown> = {
    id: MAC_TIMELINE_ID,
    name: '',
    version: 360000,
    new_version: '171.0.0',
    fps: 30.0,
    duration: 12000000,
    canvas_config: { background: null, height: 1920, ratio: 'original', width: 1080 },
    platform: platformBlock('mac', '8.7.0'),
    last_modified_platform: platformBlock('mac', '8.7.0'),
    materials: {
      videos,
      audios: [
        {
          id: 'B1000000-0000-0000-0000-000000000001',
          name: 'music.mp3',
          path: `${PLACEHOLDER}/Resources/local/${localMedia[1].fileName}`
        }
      ],
      texts: [
        {
          id: 'C1000000-0000-0000-0000-000000000001',
          content: JSON.stringify({
            styles: [{ fill: { content: { solid: { color: [1, 1, 1] } } } }],
            text: 'Hello CapShare'
          })
        }
      ],
      stickers: [
        {
          id: 'D1000000-0000-0000-0000-000000000001',
          resource_id: '7256860510790995206',
          sticker_id: '7256860510790995206',
          icon_url: 'https://example.invalid/sticker.png?x=1',
          preview_cover_url: 'https://example.invalid/sticker-preview.png',
          path: `${containerCacheJson}/${cacheSuffixes[1]}`
        }
      ],
      transitions: [
        {
          id: 'E1000000-0000-0000-0000-000000000001',
          effect_id: '7428434762538192134',
          resource_id: '7428434762538192134',
          name: 'Pull in',
          path: `${containerCacheJson}/${cacheSuffixes[0]}`
        }
      ],
      material_animations: [
        {
          id: 'F1000000-0000-0000-0000-000000000001',
          animations: [
            {
              id: '7322786421033700613',
              resource_id: '7322786421033700613',
              path: `${containerCacheJson}/${cacheSuffixes[1]}`
            }
          ]
        }
      ]
    },
    tracks: [
      {
        type: 'video',
        flag: 0,
        segments: [
          {
            material_id: 'A1000000-0000-0000-0000-000000000001',
            target_timerange: { start: 0, duration: 8000000 }
          },
          ...(looseMediaPaths.length > 0
            ? [
                {
                  material_id: 'A1000000-0000-0000-0000-000000000002',
                  target_timerange: { start: 8000000, duration: 4000000 }
                }
              ]
            : [])
        ]
      },
      {
        type: 'audio',
        flag: 0,
        segments: [
          {
            material_id: 'B1000000-0000-0000-0000-000000000001',
            target_timerange: { start: 0, duration: 12000000 }
          }
        ]
      },
      {
        type: 'text',
        flag: 0,
        segments: [
          {
            material_id: 'C1000000-0000-0000-0000-000000000001',
            target_timerange: { start: 1000000, duration: 3000000 }
          }
        ]
      }
    ]
  }

  const folderJson = folder.split('\\').join('/')
  const rootJson = machine.draftRoot.split('\\').join('/')

  const draftMaterials = [
    {
      type: 0,
      value: [
        {
          id: '4a2df7d9-66df-4838-9e58-3cee8b69078c',
          metetype: 'video',
          extra_info: 'clip-one.mp4',
          file_Path: `./Resources/local/${localMedia[0].fileName}`,
          width: 1080,
          height: 1920
        },
        ...(looseMediaPaths.length > 0
          ? [
              {
                id: '5b3ef8ea-77e0-4949-a069-4dff9c7a189d',
                metetype: 'video',
                extra_info: 'b-roll clip.mp4',
                file_Path: looseMediaPaths[0].split('\\').join('/'),
                width: 1920,
                height: 1080
              }
            ]
          : [])
      ]
    },
    { type: 1, value: [] }
  ]

  const meta: Record<string, unknown> = {
    draft_id: MAC_META_DRAFT_ID,
    draft_name: name,
    draft_cover: 'draft_cover.jpg',
    draft_fold_path: folderJson,
    draft_root_path: rootJson,
    draft_removable_storage_device: '',
    draft_new_version: '',
    draft_materials: draftMaterials,
    draft_materials_copied_info: [
      {
        dst_path: `Resources/local/${localMedia[0].fileName}`,
        src_path: `${machine.homeDir.split('\\').join('/')}/Downloads/clip-one.mp4`
      }
    ],
    tm_draft_create: createUs,
    tm_draft_modified: modifiedUs,
    tm_duration: 12000000
  }

  // Draft folder contents.
  writeJson(join(folder, 'draft_info.json'), timeline)
  writeJson(join(folder, 'draft_meta_info.json'), meta)
  write(join(folder, 'draft_cover.jpg'), TINY_JPEG)
  writeJson(join(folder, 'draft_virtual_store.json'), {
    draft_materials: [],
    draft_virtual_store: []
  })
  writeJson(join(folder, 'key_value.json'), { someKey: 'someValue' })
  write(
    join(folder, 'draft_settings'),
    '[General]\ndraft_create_time=1780756859\ndraft_last_edit_time=1780765222\n'
  )
  // Volatile files that must never survive export/import.
  writeJson(join(folder, 'draft_info.json.bak'), timeline)
  writeJson(join(folder, 'template.tmp'), { config: { material_save_mode: 1 } })
  writeJson(join(folder, 'template-2.tmp'), timeline)
  // Regenerable AI cache (lean export excludes this).
  write(join(folder, 'matting', 'b1a56d331f3a9f02', '2'), Buffer.alloc(2048, 7))
  write(join(folder, '.DS_Store'), Buffer.alloc(16, 0))

  // Registry at the draft root.
  writeJson(join(machine.draftRoot, 'root_meta_info.json'), {
    all_draft_store: [
      {
        draft_id: MAC_META_DRAFT_ID,
        draft_name: name,
        draft_cover: `${folderJson}/draft_cover.jpg`,
        draft_fold_path: folderJson,
        draft_json_file: `${folderJson}/draft_info.json`,
        draft_root_path: rootJson,
        draft_timeline_materials_size: 1234,
        tm_draft_create: createUs,
        tm_draft_modified: modifiedUs,
        tm_draft_removed: 0,
        tm_duration: 12000000
      }
    ],
    draft_ids: 1,
    root_path: rootJson
  })

  return {
    folder,
    name,
    timelineId: MAC_TIMELINE_ID,
    metaDraftId: MAC_META_DRAFT_ID,
    timelineFilename: 'draft_info.json',
    cacheSuffixes,
    looseMediaPaths,
    localMedia
  }
}

/**
 * Creates a Windows-flavored draft folder in `dir` exactly as a real Windows
 * CapCut 8.5 would have written it: draft_content.json, forward-slash C:/D:/
 * paths, AppData cache locations. Used to build "imported from Windows"
 * archives without needing drive letters on the test machine.
 */
export function createWinFlavoredDraftFolder(
  dir: string,
  name = 'Win Project'
): {
  folder: string
  timelineId: string
  metaDraftId: string
  cacheSuffixes: string[]
  looseMediaJsonPath: string
  localMediaFile: string
} {
  const folder = join(dir, name)
  const timelineId = '3F84C366-22B2-5D51-AE44-AF1F21D019EE'
  const metaDraftId = 'ADB8A987-CFE1-5FB3-C39E-F987E491B1CB'
  const cacheSuffixes = [
    'effect/9290989/8179e342aabbccdd',
    'artistEffect/7233768284833713414/1a5aec7271a74bff'
  ]
  const looseMediaJsonPath = 'D:/Footage/session 5/voiceover_final.wav'
  const localMediaFile = '16b08377935c11f0aa11223344556677.mp4'

  write(join(folder, 'Resources', 'local', localMediaFile), Buffer.from('win-local-media-bytes'))

  const winCache = 'C:/Users/Tester/AppData/Local/CapCut/User Data/Cache'
  const timeline: Record<string, unknown> = {
    id: timelineId,
    name: '',
    version: 360000,
    new_version: '167.0.0',
    fps: 60.0,
    duration: 6000000,
    canvas_config: { background: null, height: 1080, ratio: 'original', width: 1920 },
    platform: platformBlock('windows', '8.5.0'),
    last_modified_platform: platformBlock('windows', '8.5.0'),
    materials: {
      videos: [
        {
          id: 'A2000000-0000-0000-0000-000000000001',
          type: 'video',
          material_name: 'main.mp4',
          path: `${PLACEHOLDER}/Resources/local/${localMediaFile}`,
          width: 1920,
          height: 1080
        }
      ],
      audios: [
        {
          id: 'B2000000-0000-0000-0000-000000000001',
          name: 'voiceover_final.wav',
          path: looseMediaJsonPath
        }
      ],
      texts: [],
      stickers: [],
      transitions: [
        {
          id: 'E2000000-0000-0000-0000-000000000001',
          effect_id: '9290989',
          resource_id: '9290989',
          name: 'Wipe',
          path: `${winCache}/${cacheSuffixes[0]}`
        }
      ],
      material_animations: []
    },
    tracks: [
      {
        type: 'video',
        flag: 0,
        segments: [
          {
            material_id: 'A2000000-0000-0000-0000-000000000001',
            target_timerange: { start: 0, duration: 6000000 }
          }
        ]
      },
      {
        type: 'audio',
        flag: 0,
        segments: [
          {
            material_id: 'B2000000-0000-0000-0000-000000000001',
            target_timerange: { start: 0, duration: 6000000 }
          }
        ]
      }
    ]
  }

  const meta: Record<string, unknown> = {
    draft_id: metaDraftId,
    draft_name: name,
    draft_cover: 'draft_cover.jpg',
    draft_fold_path: `C:/Users/Tester/AppData/Local/CapCut/User Data/Projects/com.lveditor.draft/${name}`,
    draft_root_path: 'C:/Users/Tester/AppData/Local/CapCut/User Data/Projects/com.lveditor.draft',
    draft_removable_storage_device: '',
    draft_new_version: '',
    draft_materials: [
      {
        type: 0,
        value: [
          {
            id: '7c4ef9fb-88f1-5a5a-b17a-5e0fad8b290e',
            metetype: 'video',
            extra_info: 'main.mp4',
            file_Path: `./Resources/local/${localMediaFile}`
          },
          {
            id: '8d5f0a0c-99a2-6b6b-c28b-6f10be9c3a1f',
            metetype: 'music',
            extra_info: 'voiceover_final.wav',
            file_Path: looseMediaJsonPath
          }
        ]
      }
    ],
    draft_materials_copied_info: [],
    tm_draft_create: 1780000000000000,
    tm_draft_modified: 1780100000000000,
    tm_duration: 6000000
  }

  writeJson(join(folder, 'draft_content.json'), timeline)
  writeJson(join(folder, 'draft_meta_info.json'), meta)
  write(join(folder, 'draft_cover.jpg'), TINY_JPEG)
  writeJson(join(folder, 'draft_content.json.bak'), timeline)
  writeJson(join(folder, 'template-2.tmp'), timeline)
  write(
    join(folder, 'draft_settings'),
    '[General]\ndraft_create_time=1780000000\ndraft_last_edit_time=1780100000\n'
  )

  return { folder, timelineId, metaDraftId, cacheSuffixes, looseMediaJsonPath, localMediaFile }
}
