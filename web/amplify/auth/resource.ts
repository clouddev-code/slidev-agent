import { defineAuth } from '@aws-amplify/backend';

/**
 * Cognito User Pool configuration. Email-based sign-up with verification.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});
