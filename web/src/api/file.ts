import { get, post } from './http'

export async function fileList(path: string, userNameSpace?: string) {
  return get('/file/list', { path, userNameSpace })
}

export async function fileGet(path: string) {
  return get('/file/get', { path })
}

export async function fileSave(path: string, content: string) {
  return post('/file/save', { path, content })
}

export async function fileMkdir(path: string) {
  return post('/file/mkdir', { path })
}

export async function fileUpload(files: File[], path: string) {
  const formData = new FormData()
  files.forEach((f) => formData.append('files', f))
  formData.append('path', path)
  return post('/file/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export async function fileDownload(path: string) {
  return get('/file/download', { path })
}

export async function fileDelete(path: string) {
  return post('/file/delete', { path })
}

export async function fileDeleteMulti(paths: string[]) {
  return post('/file/deleteMulti', { paths })
}

export async function fileRestore(path: string, zipFile?: File) {
  const formData = new FormData()
  formData.append('path', path)
  if (zipFile) formData.append('file', zipFile)
  return post('/file/restore', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export async function fileParse(path: string) {
  return get('/file/parse', { path })
}

export async function fileImportPreview(path: string) {
  return post('/file/importPreview', { path })
}
