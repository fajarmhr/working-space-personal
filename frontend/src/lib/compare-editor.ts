import * as monaco from 'monaco-editor/editor/editor.api'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import 'monaco-editor/features/codicon/register'
import 'monaco-editor/editor/browser/coreCommands'
import 'monaco-editor/editor/contrib/find/browser/findController'
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard'
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations'
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching'
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu'
import 'monaco-editor/basic-languages/monaco.contribution'

globalThis.MonacoEnvironment = { getWorker: () => new EditorWorker() }
if (!monaco.languages.getLanguages().some((language) => language.id === 'json'))
  monaco.languages.register({ id: 'json', extensions: ['.json', '.jsonc', '.jsonl'] })

for (const [name, dark] of [
  ['ruang-compare-light', false],
  ['ruang-compare-dark', true],
] as const) {
  monaco.editor.defineTheme(name, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': dark ? '#1e2725' : '#ffffff',
      'editor.foreground': dark ? '#e6ece9' : '#252d2c',
      'editorLineNumber.foreground': dark ? '#81978e' : '#91a09b',
      'editorLineNumber.activeForeground': dark ? '#8bc9b0' : '#23745c',
      'editorCursor.foreground': dark ? '#8bc9b0' : '#23745c',
      'editor.selectionBackground': dark ? '#3d695955' : '#23745c22',
      'editor.lineHighlightBackground': dark ? '#ffffff04' : '#23745c04',
      'editorWhitespace.foreground': dark ? '#67786f' : '#c4ceca',
      'diffEditor.insertedTextBackground': dark ? '#478a6150' : '#468a612b',
      'diffEditor.removedTextBackground': dark ? '#b4484850' : '#b4484828',
      'diffEditor.insertedLineBackground': dark ? '#254d302e' : '#e9f5ed99',
      'diffEditor.removedLineBackground': dark ? '#752b2b2e' : '#fbeeee99',
      'diffEditor.diagonalFill': dark ? '#2c3832' : '#e5ece8',
      'diffEditor.border': dark ? '#34403b' : '#e8edeb',
      focusBorder: dark ? '#8bc9b0' : '#23745c',
      'editorWidget.background': dark ? '#25312d' : '#f9fafb',
      'editorWidget.border': dark ? '#405249' : '#d5e0da',
      'input.background': dark ? '#161c1b' : '#ffffff',
      'input.foreground': dark ? '#e6ece9' : '#252d2c',
      'inputOption.activeBorder': dark ? '#8bc9b0' : '#23745c',
      'inputOption.activeBackground': dark ? '#8bc9b022' : '#23745c18',
    },
  })
}

export { monaco }
