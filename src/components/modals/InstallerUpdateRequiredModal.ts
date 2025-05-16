import { App, Modal } from 'obsidian'

export class InstallerUpdateRequiredModal extends Modal {
  constructor(app: App) {
    super(app)

    this.setTitle('True Copilot Requires Obsidian Update')

    const messageEl = this.contentEl.createDiv()
    messageEl.createSpan({
      text: "True Copilot requires a newer version of the Obsidian installer. Please note that this is different from Obsidian's in-app updates. You must download the latest version of Obsidian manually to continue using True Copilot.",
    })
    messageEl.style.marginBottom = '1rem'

    this.contentEl.createEl('a', {
      text: 'Open Download Page',
      href: 'https://obsidian.md/download',
    })
  }
}
