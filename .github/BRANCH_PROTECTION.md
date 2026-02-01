# Branch Protection Setup

This document describes the recommended branch protection rules for this repository.

## Why Branch Protection?

Even as a solo developer, branch protection helps you:

- **Prevent accidental force pushes** to main branch
- **Ensure CI passes** before merging (catches mistakes before they hit production)
- **Maintain a clean history** by requiring PRs instead of direct commits
- **Create a paper trail** of changes through PR descriptions

## Setup Instructions

### 1. Navigate to Branch Protection Settings

1. Go to your repository on GitHub
2. Click **Settings** (gear icon)
3. In the left sidebar, click **Branches** under "Code and automation"
4. Click **Add branch protection rule** (or edit existing)

### 2. Recommended Settings for `main` Branch

Enter `main` (or `master`) as the branch name pattern, then enable:

#### Required Settings

- [x] **Require a pull request before merging**
  - This prevents direct pushes to main
  - As a solo dev, you don't need approvals, just the PR workflow

- [x] **Require status checks to pass before merging**
  - Click "Search for status checks"
  - Select: `Test, Type Check & Build` (from ci.yml)
  - [x] **Require branches to be up to date before merging**

- [x] **Require conversation resolution before merging**
  - Ensures you address any comments/issues before merging

#### Recommended Settings

- [x] **Do not allow bypassing the above settings**
  - Prevents you from accidentally bypassing protections
  - You can temporarily disable this if needed

- [x] **Restrict deletions**
  - Prevents accidental deletion of the main branch

- [ ] **Require signed commits** (Optional)
  - Extra security, but requires GPG setup

#### Settings to Leave Disabled (Solo Dev)

- [ ] Require approvals (you're the only approver)
- [ ] Require review from Code Owners
- [ ] Require linear history (can be annoying for solo work)

### 3. Click "Create" or "Save changes"

## Quick Setup via GitHub CLI

If you have the GitHub CLI installed, you can run:

```bash
gh api repos/{owner}/{repo}/branches/main/protection -X PUT -f "required_status_checks[strict]=true" -f "required_status_checks[contexts][]=Test, Type Check & Build" -f "enforce_admins=true" -f "required_pull_request_reviews=null" -f "restrictions=null"
```

Replace `{owner}` and `{repo}` with your values.

## Workflow After Setup

1. Create a feature branch: `git checkout -b feature/my-change`
2. Make changes and commit
3. Push branch: `git push -u origin feature/my-change`
4. Create PR on GitHub (or via `gh pr create`)
5. Wait for CI to pass
6. Merge PR (squash recommended for cleaner history)
7. Delete feature branch

## Temporarily Bypassing (Emergency Only)

If you need to bypass protections in an emergency:

1. Go to Settings > Branches
2. Edit the protection rule
3. Uncheck "Do not allow bypassing the above settings"
4. Make your emergency change
5. **Re-enable the setting immediately after**

## See Also

- [GitHub Docs: Protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub Docs: Managing branch protection rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)
