/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { CreateResourceButton } from '@/components/CreateResourceButton'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useCreateVolumeMutation } from '@/hooks/mutations/useCreateVolumeMutation'
import { useSelectedOrganization } from '@/hooks/useSelectedOrganization'
import { handleApiError } from '@/lib/error-handling'
import { useForm } from '@tanstack/react-form'
import { Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

const formSchema = z
  .object({
    name: z.string().trim().min(1, 'Volume name is required'),
    backendType: z.enum(['managed_s3', 'juicefs']),
    metaUrl: z.string(),
    cacheSizeMiB: z.string(),
    metaPassword: z.string(),
  })
  .superRefine((value, context) => {
    if (value.backendType !== 'juicefs') return
    if (!value.metaUrl.trim()) {
      context.addIssue({ code: 'custom', path: ['metaUrl'], message: 'Metadata URL is required' })
    } else {
      try {
        const url = new URL(value.metaUrl)
        if (!url.protocol) throw new Error()
        if (url.password) {
          context.addIssue({ code: 'custom', path: ['metaUrl'], message: 'Put the password in the password field' })
        }
      } catch {
        context.addIssue({ code: 'custom', path: ['metaUrl'], message: 'Enter an absolute URL with a scheme' })
      }
    }

    const cacheSize = Number(value.cacheSizeMiB)
    if (!Number.isInteger(cacheSize) || cacheSize < 0) {
      context.addIssue({ code: 'custom', path: ['cacheSizeMiB'], message: 'Cache size must be a non-negative integer' })
    }
  })

type FormValues = z.infer<typeof formSchema>

const defaultValues: FormValues = {
  name: '',
  backendType: 'managed_s3',
  metaUrl: '',
  cacheSizeMiB: '10240',
  metaPassword: '',
}

export const CreateVolumeSheet = ({
  className,
  disabled,
  ref,
}: {
  className?: string
  disabled?: boolean
  ref?: Ref<{ open: () => void }>
}) => {
  const [open, setOpen] = useState(false)

  const { selectedOrganization } = useSelectedOrganization()
  const { reset: resetCreateVolumeMutation, ...createVolumeMutation } = useCreateVolumeMutation()
  const formRef = useRef<HTMLFormElement>(null)

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
  }))

  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: formSchema,
    },
    onSubmitInvalid: () => {
      const formEl = formRef.current
      if (!formEl) return
      const invalidInput = formEl.querySelector('[aria-invalid="true"]') as HTMLInputElement | null
      if (invalidInput) {
        invalidInput.scrollIntoView({ behavior: 'smooth', block: 'center' })
        invalidInput.focus()
      }
    },
    onSubmit: async ({ value }) => {
      if (!selectedOrganization?.id) {
        toast.error('Select an organization to create a volume.')
        return
      }

      try {
        const volumeName = value.name.trim()

        await createVolumeMutation.mutateAsync({
          volume: {
            name: volumeName,
            backend:
              value.backendType === 'juicefs'
                ? {
                    type: 'juicefs',
                    metaUrl: value.metaUrl.trim(),
                    cacheSizeMiB: Number(value.cacheSizeMiB),
                    credential: value.metaPassword ? { metaPassword: value.metaPassword } : undefined,
                  }
                : { type: 'managed_s3' },
          },
          organizationId: selectedOrganization.id,
        })

        setOpen(false)
        toast.success(`Creating volume ${volumeName}`)
      } catch (error) {
        handleApiError(error, 'Failed to create volume')
      }
    },
  })
  const { reset: resetForm } = form

  const resetState = useCallback(() => {
    resetForm(defaultValues)
    resetCreateVolumeMutation()
  }, [resetForm, resetCreateVolumeMutation])

  useEffect(() => {
    if (open) {
      resetState()
    }
  }, [open, resetState])

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) resetState()
      }}
    >
      <SheetTrigger asChild>
        <CreateResourceButton resource="Volume" disabled={disabled} className={className} />
      </SheetTrigger>
      <SheetContent className="w-dvw sm:w-[420px] p-0 flex flex-col gap-0">
        <SheetHeader className="border-b border-border p-4 px-5 items-center flex text-left flex-row">
          <SheetTitle>Create Volume</SheetTitle>
          <SheetDescription className="sr-only">Create a new volume for shared, persistent storage.</SheetDescription>
        </SheetHeader>

        <ScrollArea fade="mask" className="flex-1 min-h-0">
          <form
            ref={formRef}
            id="create-volume-form"
            className="p-5"
            onSubmit={(e) => {
              e.preventDefault()
              e.stopPropagation()
              form.handleSubmit()
            }}
          >
            <FieldGroup>
              <form.Field name="name">
                {(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor={field.name}>Volume Name</FieldLabel>
                      <Input
                        aria-invalid={isInvalid}
                        id={field.name}
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="my-volume"
                      />
                      <FieldDescription>Used to mount this volume in your sandboxes.</FieldDescription>
                      {field.state.meta.errors.length > 0 && field.state.meta.isTouched && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="backendType">
                {(field) => (
                  <Field>
                    <FieldLabel>Storage Backend</FieldLabel>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      value={field.state.value}
                      onValueChange={(value) => value && field.handleChange(value as FormValues['backendType'])}
                    >
                      <ToggleGroupItem value="managed_s3" aria-label="Managed S3">
                        Managed S3
                      </ToggleGroupItem>
                      <ToggleGroupItem value="juicefs" aria-label="JuiceFS">
                        JuiceFS
                      </ToggleGroupItem>
                    </ToggleGroup>
                    <FieldDescription>
                      Managed S3 is owned by Daytona. JuiceFS references an existing external filesystem.
                    </FieldDescription>
                  </Field>
                )}
              </form.Field>
              <form.Subscribe selector={(state) => state.values.backendType}>
                {(backendType) =>
                  backendType === 'juicefs' ? (
                    <FieldGroup>
                      <form.Field name="metaUrl">
                        {(field) => {
                          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
                          return (
                            <Field data-invalid={isInvalid}>
                              <FieldLabel htmlFor={field.name}>Metadata URL</FieldLabel>
                              <Input
                                aria-invalid={isInvalid}
                                id={field.name}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                placeholder="redis://juicefs-meta:6379/12"
                              />
                              <FieldDescription>
                                The JuiceFS filesystem must already be formatted. Do not include a password in this URL.
                              </FieldDescription>
                              {isInvalid && <FieldError errors={field.state.meta.errors} />}
                            </Field>
                          )
                        }}
                      </form.Field>
                      <form.Field name="cacheSizeMiB">
                        {(field) => {
                          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
                          return (
                            <Field data-invalid={isInvalid}>
                              <FieldLabel htmlFor={field.name}>Runner Cache Size (MiB)</FieldLabel>
                              <Input
                                aria-invalid={isInvalid}
                                id={field.name}
                                type="number"
                                min={0}
                                step={1}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                              />
                              {isInvalid && <FieldError errors={field.state.meta.errors} />}
                            </Field>
                          )
                        }}
                      </form.Field>
                      <form.Field name="metaPassword">
                        {(field) => (
                          <Field>
                            <FieldLabel htmlFor={field.name}>Metadata Password</FieldLabel>
                            <Input
                              id={field.name}
                              type="password"
                              autoComplete="new-password"
                              value={field.state.value}
                              onChange={(event) => field.handleChange(event.target.value)}
                            />
                            <FieldDescription>
                              Encrypted by Daytona and sent only to the Runner mount process.
                            </FieldDescription>
                          </Field>
                        )}
                      </form.Field>
                    </FieldGroup>
                  ) : null
                }
              </form.Subscribe>
            </FieldGroup>
          </form>
        </ScrollArea>

        <SheetFooter className="border-t border-border p-4 px-5">
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <form.Subscribe
            selector={(state) => [state.canSubmit, state.isSubmitting]}
            children={([canSubmit, isSubmitting]) => (
              <Button
                type="submit"
                size="sm"
                form="create-volume-form"
                variant="default"
                disabled={!canSubmit || isSubmitting || !selectedOrganization?.id}
              >
                {isSubmitting && <Spinner />}
                Create
              </Button>
            )}
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
