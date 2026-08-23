// Whether a published package declares the repository npm's provenance check demands.
//
// Every package here sets `publishConfig.provenance: true`, and npm verifies the signed
// provenance bundle against `repository.url` at publish time. None of the eleven declared a
// repository at all, so the registry answered `422 … "repository.url" is "", expected to match
// https://github.com/usetheokit/theokit-gateways` and refused all eleven at once — after the
// build, the tests and the live gate had already run for nine minutes.
//
// It had been publishable before because npm did not always enforce it; the workflow pins "an npm
// that speaks OIDC (>= 11.5.1)", and the newer client checks. That is the shape worth naming: the
// defect did not change, the world did, and nothing here could see it until a release failed.
//
// @module

/** The remote every published package must name. */
export const EXPECTED_REMOTE = "git+https://github.com/usetheokit/theokit-gateways.git";

/**
 * What is wrong with this package's `repository`, or undefined when nothing is.
 *
 * Returns a reason rather than a boolean because "absent", "wrong remote" and "wrong directory"
 * are different problems with different fixes, and a gate that collapses them makes the reader
 * open the file to find out which one they have.
 *
 * @param {Record<string, unknown>} manifest the parsed package.json
 * @param {string} dir the package's directory name under `packages/`
 * @returns {string | undefined}
 */
export function repositoryProblem(manifest, dir) {
  const repository = manifest.repository;
  if (repository === undefined) return "declares no repository";
  if (typeof repository !== "object" || repository === null) {
    return `declares a ${typeof repository} repository; npm provenance needs an object with a url`;
  }
  const { url, directory } = /** @type {{url?: unknown, directory?: unknown}} */ (repository);
  if (typeof url !== "string" || url.length === 0) return "declares a repository with no url";
  if (url !== EXPECTED_REMOTE) return `declares ${url}, not ${EXPECTED_REMOTE}`;
  // The directory is what points a consumer at the right subtree of a monorepo. npm does not
  // reject a missing one, so it is checked here or nowhere.
  const expected = `packages/${dir}`;
  if (directory !== expected) return `declares directory ${String(directory)}, not ${expected}`;
  return undefined;
}
