import clsx from 'clsx'
import { Eye, EyeOff, X } from 'lucide-react'
import { PropsWithChildren, useCallback } from 'react'

import { useSettings } from '../../../contexts/settings-context'
import {
  Mentionable,
  MentionableBlock,
  MentionableCurrentFile,
  MentionableFile,
  MentionableFolder,
  MentionableImage,
  MentionableUrl,
  MentionableVault,
} from '../../../types/mentionable'

import { getMentionableIcon } from './utils/get-metionable-icon'

function BadgeBase({
  children,
  onDelete,
  onClick,
  isFocused,
}: PropsWithChildren<{
  onDelete: () => void
  onClick: () => void
  isFocused: boolean
}>) {
  return (
    <div
      className={`smtcmp-chat-user-input-file-badge ${isFocused ? 'smtcmp-chat-user-input-file-badge-focused' : ''}`}
      onClick={onClick}
    >
      {children}
      <div
        className="smtcmp-chat-user-input-file-badge-delete"
        onClick={(evt) => {
          evt.stopPropagation()
          onDelete()
        }}
      >
        <X size={12} />
      </div>
    </div>
  )
}

function FileBadge({
  mentionable,
  onDelete,
  onClick,
  isFocused,
}: {
  mentionable: MentionableFile
  onDelete: () => void
  onClick: () => void
  isFocused: boolean
}) {
  const Icon = getMentionableIcon(mentionable)
  return (
    <BadgeBase onDelete={onDelete} onClick={onClick} isFocused={isFocused}>
      <div className="smtcmp-chat-user-input-file-badge-name">
        {Icon && (
          <Icon
            size={12}
            className="smtcmp-chat-user-input-file-badge-name-icon"
          />
        )}
        <span>{mentionable.file.name}</span>
      </div>
    </BadgeBase>
  )
}

function FolderBadge({
  mentionable,
  onDelete,
  onClick,
  isFocused,
}: {
  mentionable: MentionableFolder
  onDelete: () => void
  onClick: () => void
  isFocused: boolean
}) {
  const Icon = getMentionableIcon(mentionable)
  return (
    <BadgeBase onDelete={onDelete} onClick={onClick} isFocused={isFocused}>
      <div className="smtcmp-chat-user-input-file-badge-name">
        {Icon && (
          <Icon
            size={12}
            className="smtcmp-chat-user-input-file-badge-name-icon"
          />
        )}
        <span>{mentionable.folder.name}</span>
      </div>
    </BadgeBase>
  )
}

function VaultBadge({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mentionable,
  onDelete,
  onClick,
  isFocused,
}: {
  mentionable: MentionableVault
  onDelete: () => void
  onClick: () => void
  isFocused: boolean
}) {
  const Icon = getMentionableIcon(mentionable)
  return (
    <BadgeBase onDelete={onDelete} onClick={onClick} isFocused={isFocused}>
      <div className="smtcmp-chat-user-input-file-badge-name">
        {Icon && (
          <Icon
            size={12}
            className="smtcmp-chat-user-input-file-badge-name-icon"
          />
        )}
        <span>Vault</span>
      </div>
    </BadgeBase>
  )
}

function CurrentFileBadge({
  mentionable,
  onDelete,
  onClick,
  isFocused,
}: {
  mentionable: MentionableCurrentFile
  onDelete: () => void
  onClick: () => void
  isFocused: boolean
}) {
  const { settings, setSettings } = useSettings()

  const handleCurrentFileToggle = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      setSettings({
        ...settings,
        chatOptions: {
          ...settings.chatOptions,
          includeCurrentFileContent:
            !settings.chatOptions.includeCurrentFileContent,
        },
      })
    },
    [settings, setSettings],
  )

  const Icon = getMentionableIcon(mentionable)
  return mentionable.file ? (
    <BadgeBase onDelete={onDelete} onClick={onClick} isFocused={isFocused}>
      <div className="smtcmp-chat-user-input-file-badge-name">
        {Icon && (
          <Icon
            size={12}
            className="smtcmp-chat-user-input-file-badge-name-icon"
          />
        )}
        <span
          className={clsx(
            !settings.chatOptions.includeCurrentFileContent &&
              'smtcmp-excluded-content',
          )}
        >
          {mentionable.file.name}
        </span>
      </div>
      <div
        className={clsx(
          'smtcmp-chat-user-input-file-badge-name-suffix',
          !settings.chatOptions.includeCurrentFileContent &&
            'smtcmp-excluded-content',
        )}
      >
        {' (Current File)'}
      </div>
      <div
        className="smtcmp-chat-user-input-file-badge-eye"
        onClick={handleCurrentFileToggle}
      >
        {settings.chatOptions.includeCurrentFileContent ? (
          <Eye size={12} />
        ) : (
          <EyeOff size={12} />
        )}
      </div>
    </BadgeBase>
  ) : null
}

function BlockBadge({
  mentionable,
  onDelete,
  onClick,
  isFocused,
}: {
  mentionable: MentionableBlock
  onDelete: () => void
  onClick: () => void
  isFocused: boolean
}) {
  const Icon = getMentionableIcon(mentionable)
  return (
    <BadgeBase onDelete={onDelete} onClick={onClick} isFocused={isFocused}>
      <div className="smtcmp-chat-user-input-file-badge-name">
        {Icon && (
          <Icon
            size={12}
            className="smtcmp-chat-user-input-file-badge-name-icon"
          />
        )}
        <span>{mentionable.file.name}</span>
      </div>
      <div className="smtcmp-chat-user-input-file-badge-name-suffix">
        {` (${mentionable.startLine}:${mentionable.endLine})`}
      </div>
    </BadgeBase>
  )
}

function UrlBadge({
  mentionable,
  onDelete,
  onClick,
  isFocused,
}: {
  mentionable: MentionableUrl
  onDelete: () => void
  onClick: () => void
  isFocused: boolean
}) {
  const Icon = getMentionableIcon(mentionable)
  return (
    <BadgeBase onDelete={onDelete} onClick={onClick} isFocused={isFocused}>
      <div className="smtcmp-chat-user-input-file-badge-name">
        {Icon && (
          <Icon
            size={12}
            className="smtcmp-chat-user-input-file-badge-name-icon"
          />
        )}
        <span>{mentionable.url}</span>
      </div>
    </BadgeBase>
  )
}

function ImageBadge({
  mentionable,
  onDelete,
  onClick,
  isFocused,
}: {
  mentionable: MentionableImage
  onDelete: () => void
  onClick: () => void
  isFocused: boolean
}) {
  const Icon = getMentionableIcon(mentionable)
  return (
    <BadgeBase onDelete={onDelete} onClick={onClick} isFocused={isFocused}>
      <div className="smtcmp-chat-user-input-file-badge-name">
        {Icon && (
          <Icon
            size={12}
            className="smtcmp-chat-user-input-file-badge-name-icon"
          />
        )}
        <span>{mentionable.name}</span>
      </div>
    </BadgeBase>
  )
}

export default function MentionableBadge({
  mentionable,
  onDelete,
  onClick,
  isFocused = false,
}: {
  mentionable: Mentionable
  onDelete: () => void
  onClick: () => void
  isFocused?: boolean
}) {
  switch (mentionable.type) {
    case 'file':
      return (
        <FileBadge
          mentionable={mentionable}
          onDelete={onDelete}
          onClick={onClick}
          isFocused={isFocused}
        />
      )
    case 'folder':
      return (
        <FolderBadge
          mentionable={mentionable}
          onDelete={onDelete}
          onClick={onClick}
          isFocused={isFocused}
        />
      )
    case 'vault':
      return (
        <VaultBadge
          mentionable={mentionable}
          onDelete={onDelete}
          onClick={onClick}
          isFocused={isFocused}
        />
      )
    case 'current-file':
      return (
        <CurrentFileBadge
          mentionable={mentionable}
          onDelete={onDelete}
          onClick={onClick}
          isFocused={isFocused}
        />
      )
    case 'block':
      return (
        <BlockBadge
          mentionable={mentionable}
          onDelete={onDelete}
          onClick={onClick}
          isFocused={isFocused}
        />
      )
    case 'url':
      return (
        <UrlBadge
          mentionable={mentionable}
          onDelete={onDelete}
          onClick={onClick}
          isFocused={isFocused}
        />
      )
    case 'image':
      return (
        <ImageBadge
          mentionable={mentionable}
          onDelete={onDelete}
          onClick={onClick}
          isFocused={isFocused}
        />
      )
  }
}
