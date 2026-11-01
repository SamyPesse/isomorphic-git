// @ts-check
import { InternalError } from '../errors/InternalError.js'

import { dirname } from './dirname.js'
import { join } from './join.js'

const WORKTREE_FILE_MODE = 0o100644
const WORKTREE_EXECUTABLE_MODE = 0o100755
const WORKTREE_SYMLINK_MODE = 0o120000
const UNSUPPORTED_SYMLINK_CODES = new Set(['ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'])

/**
 * Prepare replacements before renaming them over existing working files or symlinks.
 * Adapters without rename support fail before touching an existing destination.
 *
 * @param {object} args
 * @param {import('../models/FileSystem.js').FileSystem} args.fs
 * @param {string} args.filepath
 * @param {Uint8Array} args.content
 * @param {number} args.mode Git blob mode to restore.
 * @param {boolean} [args.allowSymlinkStub=false] Restore a plain target file on unsupported symlink errors.
 * @returns {Promise<void>}
 */
export async function writeWorktreeFile({
  fs,
  filepath,
  content,
  mode,
  allowSymlinkStub = false,
}) {
  if (!(await fs.lstat(filepath))) {
    await writeEntry({ fs, filepath, content, mode, allowSymlinkStub })
    return
  }
  if (!fs.canRename)
    throw new InternalError(
      'Replacing existing files requires fs.rename support'
    )

  const tempdir = join(
    dirname(filepath),
    `.isomorphic-git-${Math.random().toString(36).slice(2)}`
  )
  // Use exclusive single-directory creation; never reuse a path belonging to another operation.
  await fs._mkdir(tempdir)
  const temppath = join(tempdir, 'replacement')
  try {
    await fs.verifyRename({ directory: tempdir })
    await writeEntry({
      fs,
      filepath: temppath,
      content,
      mode,
      allowSymlinkStub,
    })
    await fs.rename({ oldpath: temppath, newpath: filepath })
  } finally {
    await fs.rm(temppath)
    await fs.rmdir(tempdir)
  }
}

/** Write a new entry without following an existing destination. */
async function writeEntry({ fs, filepath, content, mode, allowSymlinkStub }) {
  if (mode === WORKTREE_SYMLINK_MODE) {
    try {
      await fs.writelink(filepath, Buffer.from(content))
    } catch (err) {
      if (!allowSymlinkStub || !UNSUPPORTED_SYMLINK_CODES.has(err.code))
        throw err
      await fs.write(filepath, content)
    }
  } else if (mode === WORKTREE_FILE_MODE) {
    await fs.write(filepath, content)
  } else if (mode === WORKTREE_EXECUTABLE_MODE) {
    await fs.write(filepath, content, { mode: 0o777 })
  } else {
    throw new InternalError(`Invalid blob mode 0o${mode.toString(8)}`)
  }
}
