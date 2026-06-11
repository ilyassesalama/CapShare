import { useState, type JSX } from 'react'
import { Clapperboard, ImageUp } from 'lucide-react'
import { Button, Input, Label, Modal, TextField, toast } from '@heroui/react'
import type { DraftSummary, UpdateProjectRequest } from '@shared/types'
import { kinematicScale } from '@/lib/dialog-anim'
import { errorMessage, unwrap } from '@/lib/ipc'
import { closeButtonClass, cn } from '@/lib/utils'

export interface EditProjectSaved {
  folderPath: string
  name: string
  /** Set when the user picked a new cover. */
  coverDataUrl: string | null
}

interface EditProjectDialogProps {
  project: DraftSummary | null
  /** Visibility is controlled separately from `project` so the project stays
      mounted while the dialog plays its close animation. */
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (updated: EditProjectSaved) => void
}

export function EditProjectDialog({
  project,
  open,
  onOpenChange,
  onSaved
}: EditProjectDialogProps): JSX.Element {
  const [name, setName] = useState('')
  const [pickedCover, setPickedCover] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Re-seed the form on every open — the same project can be edited twice.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName(project?.name ?? '')
      setPickedCover(null)
    }
  }

  const trimmed = name.trim()
  const dirty = project !== null && (trimmed !== project.name || pickedCover !== null)

  const pickCover = async (): Promise<void> => {
    try {
      const dataUrl = unwrap(await window.capshare.pickProjectCover())
      if (dataUrl) setPickedCover(dataUrl)
    } catch (error) {
      toast.danger(errorMessage(error))
    }
  }

  const save = async (): Promise<void> => {
    if (!project || !dirty || trimmed.length === 0) return
    setSaving(true)
    try {
      const request: UpdateProjectRequest = {
        folderPath: project.folderPath,
        draftId: project.draftId
      }
      if (trimmed !== project.name) request.name = trimmed
      if (pickedCover) request.coverDataUrl = pickedCover
      const result = unwrap(await window.capshare.updateProject(request))
      onSaved({ folderPath: result.folderPath, name: result.name, coverDataUrl: pickedCover })
    } catch (error) {
      toast.danger(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const cover = pickedCover ?? project?.coverDataUrl ?? null

  return (
    <Modal.Backdrop
      isOpen={open && project !== null}
      onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}
      variant="blur"
      className={kinematicScale.backdrop}
      isDismissable={!saving}
      isKeyboardDismissDisabled={saving}
    >
      <Modal.Container placement="center" size="sm" className={kinematicScale.container}>
        <Modal.Dialog
          aria-label="Edit project"
          className="app-no-drag glass-strong w-full max-w-sm rounded-3xl border-none"
        >
          <Modal.CloseTrigger
            isDisabled={saving}
            className={cn('top-3 right-3', closeButtonClass)}
          />
          <Modal.Header>
            <Modal.Heading>Edit project</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-4">
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-foreground/4">
              {cover ? (
                <img src={cover} alt="" draggable={false} className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center text-muted-foreground/40">
                  <Clapperboard className="size-10" strokeWidth={1.5} />
                </div>
              )}
            </div>
            <Button
              variant="secondary"
              className="w-full rounded-full"
              isDisabled={saving}
              onPress={() => void pickCover()}
            >
              <ImageUp className="size-4" /> Change thumbnail…
            </Button>
            <TextField
              value={name}
              onChange={setName}
              isDisabled={saving}
              fullWidth
              aria-label="Project name"
            >
              <Label>Name</Label>
              <Input placeholder="Project name" />
            </TextField>
          </Modal.Body>
          <Modal.Footer>
            <Button
              className="w-full rounded-full"
              isPending={saving}
              isDisabled={!dirty || trimmed.length === 0}
              onPress={() => void save()}
            >
              Save
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
