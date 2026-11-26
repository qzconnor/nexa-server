import { folderKey, innermostFolder } from './folders'
import type { Project, ProjectSection } from './types'

/** The separator of every project without one of its own; it is always there and can't be removed. */
export const DEFAULT_SECTION_ID = 'default'
export const DEFAULT_SECTION_NAME = 'Projekte'

/** One separator with its projects, as the sidebar shows them; a list of them is the whole order. */
export interface SectionLayout {
  id: string
  projects: string[]
}

/** The separator a project shows under: its own while that exists, else the default one. */
export function sectionIdOf(project: Pick<Project, 'sectionId'>, sections: readonly Pick<ProjectSection, 'id'>[]): string {
  const id = project.sectionId
  return id && sections.some((s) => s.id === id) ? id : DEFAULT_SECTION_ID
}

/** The separators with their projects, in the order the user arranged them. */
export function layoutOf(projects: readonly Project[], sections: readonly ProjectSection[]): SectionLayout[] {
  const layout = sections.map((s) => ({ id: s.id, projects: [] as string[] }))
  const byId = new Map(layout.map((entry) => [entry.id, entry]))
  for (const project of projects) byId.get(sectionIdOf(project, sections))?.projects.push(project.id)
  return layout
}

function withSection<P extends Project>(project: P, sectionId: string): P {
  const { sectionId: _old, ...rest } = project
  return (sectionId === DEFAULT_SECTION_ID ? rest : { ...rest, sectionId }) as P
}

/**
 * The projects and separators in the order of `layout`, every project under the separator it is listed
 * in. What the layout doesn't name keeps its place after the rest, so a stale layout loses nothing.
 */
export function applyLayout<P extends Project, S extends ProjectSection>(
  projects: readonly P[],
  sections: readonly S[],
  layout: readonly SectionLayout[],
): { projects: P[]; sections: S[] } {
  const sectionById = new Map(sections.map((s) => [s.id, s]))
  const nextSections: S[] = []
  for (const entry of layout) {
    const section = sectionById.get(entry.id)
    if (section && !nextSections.includes(section)) nextSections.push(section)
  }
  for (const section of sections) if (!nextSections.includes(section)) nextSections.push(section)

  const projectById = new Map(projects.map((p) => [p.id, p]))
  const placed = new Set<string>()
  const nextProjects: P[] = []
  for (const entry of layout) {
    if (!sectionById.has(entry.id)) continue
    for (const id of entry.projects) {
      const project = projectById.get(id)
      if (!project || placed.has(id)) continue
      placed.add(id)
      nextProjects.push(withSection(project, entry.id))
    }
  }
  for (const project of projects) if (!placed.has(project.id)) nextProjects.push(project)
  return { projects: nextProjects, sections: nextSections }
}

/** The layout with project `id` under separator `to`, right before project `before` (null: at its end). */
export function moveProject(layout: readonly SectionLayout[], id: string, to: string, before: string | null): SectionLayout[] {
  if (!layout.some((entry) => entry.id === to)) return layout.map((entry) => ({ ...entry }))
  return layout.map((entry) => {
    const projects = entry.projects.filter((p) => p !== id)
    if (entry.id !== to) return { id: entry.id, projects }
    const at = before === null ? -1 : projects.indexOf(before)
    projects.splice(at < 0 ? projects.length : at, 0, id)
    return { id: entry.id, projects }
  })
}

/** The layout with separator `id` right before separator `before` (null: at the end). */
export function moveSection(layout: readonly SectionLayout[], id: string, before: string | null): SectionLayout[] {
  const moving = layout.find((entry) => entry.id === id)
  if (!moving) return layout.map((entry) => ({ ...entry }))
  const rest = layout.filter((entry) => entry.id !== id)
  const at = before === null ? -1 : rest.findIndex((entry) => entry.id === before)
  rest.splice(at < 0 ? rest.length : at, 0, moving)
  return rest
}

/** The separator a new project in `path` comes under: the innermost one whose folder it lies in, else the default. */
export function sectionForPath(path: string, sections: readonly ProjectSection[]): string {
  return innermostFolder(path, sections.filter((s) => s.path), (s) => s.path!)?.id ?? DEFAULT_SECTION_ID
}

/** The project of a separator's own folder, whose chats show right below the heading instead of as a project. */
export function isSectionRoot(project: Pick<Project, 'path'>, section: Pick<ProjectSection, 'path'>): boolean {
  return !!section.path && folderKey(project.path) === folderKey(section.path)
}
