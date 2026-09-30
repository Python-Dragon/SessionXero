/// <reference path="../pb_data/types.d.ts" />
// The users create rule also applies to accounts created by Google sign-in, which always include the
// Google email, so "@request.body.email:isset = false" blocked every new Google account. The "no email at
// password sign-up" rule now lives in pb_hooks/auth.pb.js (onRecordCreateRequest) instead.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.createRule = "@request.body.is_admin:isset = false && @request.body.banned:isset = false && " +
    "@request.body.verified:isset = false";
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.createRule = "@request.body.is_admin:isset = false && @request.body.banned:isset = false && " +
    "@request.body.verified:isset = false && @request.body.email:isset = false";
  app.save(users);
});
