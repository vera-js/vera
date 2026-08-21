/**
 * Helper function for adding dependencies to a hook.
 *
 * @param args State items to "touch" to add to dependencies
 */
export const deps = (..._args: unknown[]) => {
  /** Deliberately empty: the tracking happens at the CALL SITE, where evaluating each argument
   * reads the property inside the current hook's context. The function exists to make those
   * reads look intentional. */
};
