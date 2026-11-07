# Quick 261108-07d: gitignore vendored .agents skill

Add `.agents/` and `skills-lock.json` to `.gitignore`. The untracked design-taste-frontend skill (1617 files, 38 MB, third-party from Leonxlnx/taste-skill) and its lock file stay on disk and out of the repo. No app code uses them.
