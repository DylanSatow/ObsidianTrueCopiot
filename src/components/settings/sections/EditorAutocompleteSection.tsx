import { useSettings } from '../../../contexts/settings-context'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianToggle } from '../../common/ObsidianToggle'

export function EditorAutocompleteSection() {
  const { settings, setSettings } = useSettings()

  return (
    <>
      <ObsidianSetting
        name="Editor Autocomplete"
        desc="Configure autocomplete behavior in the main editor"
        heading
      />

      <ObsidianSetting
        name="Enable autocomplete"
        desc="Show autocomplete suggestions while typing in the editor"
      >
        <ObsidianToggle
          value={settings.editorAutocomplete.enabled}
          onChange={(value: boolean) => {
            setSettings({
              ...settings,
              editorAutocomplete: {
                ...settings.editorAutocomplete,
                enabled: value,
              },
            })
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Minimum characters"
        desc="Minimum number of characters to type before showing autocomplete suggestions"
      >
        <input
          type="number"
          value={settings.editorAutocomplete.minChars}
          min={1}
          max={20}
          step={1}
          onChange={(e) => {
            const value = parseInt(e.target.value, 10)
            if (!isNaN(value)) {
              setSettings({
                ...settings,
                editorAutocomplete: {
                  ...settings.editorAutocomplete,
                  minChars: value,
                },
              })
            }
          }}
          style={{ width: '60px' }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Debounce delay"
        desc="Delay in milliseconds between typing and showing autocomplete suggestions"
      >
        <input
          type="number"
          value={settings.editorAutocomplete.debounceMs}
          min={100}
          max={1000}
          step={50}
          onChange={(e) => {
            const value = parseInt(e.target.value, 10)
            if (!isNaN(value)) {
              setSettings({
                ...settings,
                editorAutocomplete: {
                  ...settings.editorAutocomplete,
                  debounceMs: value,
                },
              })
            }
          }}
          style={{ width: '60px' }}
        />
        <span style={{ marginLeft: '8px' }}>ms</span>
      </ObsidianSetting>
      
      <ObsidianSetting
        name="Max tokens"
        desc="Maximum number of tokens to generate for each completion"
      >
        <input
          type="number"
          value={settings.editorAutocomplete.maxTokens}
          min={10}
          max={200}
          step={10}
          onChange={(e) => {
            const value = parseInt(e.target.value, 10)
            if (!isNaN(value)) {
              setSettings({
                ...settings,
                editorAutocomplete: {
                  ...settings.editorAutocomplete,
                  maxTokens: value,
                },
              })
            }
          }}
          style={{ width: '60px' }}
        />
      </ObsidianSetting>
      
      <ObsidianSetting
        name="Temperature"
        desc="Controls randomness: Lower values are more focused, higher values more creative"
      >
        <input
          type="range"
          value={settings.editorAutocomplete.temperature}
          min={0}
          max={1}
          step={0.1}
          onChange={(e) => {
            const value = parseFloat(e.target.value)
            setSettings({
              ...settings,
              editorAutocomplete: {
                ...settings.editorAutocomplete,
                temperature: value,
              },
            })
          }}
          style={{ width: '150px' }}
        />
        <span style={{ marginLeft: '8px' }}>{settings.editorAutocomplete.temperature.toFixed(1)}</span>
      </ObsidianSetting>
    </>
  )
} 