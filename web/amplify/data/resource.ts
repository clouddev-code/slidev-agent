import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { generateSlides } from '../functions/generate-slides/resource';

/**
 * AppSync schema. `SlideJob` is owner-scoped: each Cognito user only sees
 * their own jobs. Frontend subscribes to status/log changes via
 * `observeQuery({ id })`. The generate-slides Lambda is granted full
 * mutation access via IAM (it updates status/logs/s3Key as the agent runs).
 */
const schema = a.schema({
  SlideJob: a
    .model({
      topic: a.string().required(),
      numSlides: a.integer().default(10),
      style: a.enum(['technical', 'business', 'educational', 'pitch']),
      theme: a.string().default('penguin'),
      language: a.string().default('ja'),
      status: a.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED']),
      identityId: a.string(),
      s3Key: a.string(),
      logs: a.string().array(),
      errorMessage: a.string(),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.resource(generateSlides).to(['read', 'update']),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
