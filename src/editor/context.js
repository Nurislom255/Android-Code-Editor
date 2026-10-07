// editor/context.js — what an editor state may need to know about its
// surroundings (which document it shows, the other open files, the project's
// file list) without importing the workspace. The app fills `editorEnv` in;
// each state carries its document id in the `docInfo` facet.
//
// Lookups go through functions, not copied values, so a rename or a newly
// opened file is seen immediately without rebuilding any editor state.

import { Facet } from '@codemirror/state';

/** {id, langId} of the document an EditorState belongs to. */
export const docInfo = Facet.define({ combine: (values) => values[0] || null });

export const editorEnv = {
  /** @returns {{id:number, name:string, state:import('@codemirror/state').EditorState}[]} */
  openDocs: () => [],
  /** @returns {string|null} project-relative path of a document */
  docPath: (_id) => null,
  /** @returns {Promise<string[]>} every project file (respecting ignore rules) */
  projectFiles: async () => [],
};

export function setEditorEnv(patch) {
  Object.assign(editorEnv, patch);
}
