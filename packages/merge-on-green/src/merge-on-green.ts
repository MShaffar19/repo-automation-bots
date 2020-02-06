/**
 * Copyright 2020 Google LLC. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Application } from 'probot';
import { GitHubAPI } from 'probot/lib/github';
import { PullsListCommitsResponseItem, Response } from '@octokit/rest';
import {Datastore} from '@google-cloud/datastore';

const TABLE = 'mog-prs';
const datastore = new Datastore();
const MAX_TEST_TIME = 5000 // 1000 * 60 * 60 * 3 // 3 hr.
const MERGE_ON_GREEN_LABEL = 'automerge';

interface WatchPR {
  number: number;
  repo: string;
  owner: string;
  state: 'continue'|'stop'
}

async function listPRs(): Promise<WatchPR[]> {
  const query = datastore.createQuery(TABLE).order('created');
  const [prs] = await datastore.runQuery(query);
  const result: WatchPR[] = [];
  for (const pr of prs) {
    const created = (new Date(pr.created)).getTime();
    const now = (new Date()).getTime();
    const name = pr[datastore.KEY].name;
    let state = 'continue';
    if ((now - created) > MAX_TEST_TIME) {
      console.warn(`deleting stale PR ${name}`);
      await removePR(name);
      state = 'stop';
    }
    result.push({
      number: name,
      owner: pr.owner,
      repo: pr.repo,
      state: state as 'continue'|'stop'
    });
  }
  return result;
}

async function removePR(pr: string) {
  const key = datastore.key([TABLE, pr]);
  await datastore.delete(key);
}

async function addPR(wp: WatchPR) {
  const key = datastore.key([TABLE, wp.number]);
  const entity = {
    key,
    data: {
      created: new Date().toJSON(),
      owner: wp.owner,
      repo: wp.repo
    },
    method: 'upsert'
  };
  await datastore.save(entity);
}

export = (app: Application) => {
  app.on(['schedule.repository'], async context => {
    const watchedPRs = await listPRs();
    for (const wp of watchedPRs) {
      // await maybeMergeOnGreen(context.github, wp);
    }
  });
  app.on('pull_request.labeled', async context => {
    // if missing the label, skip
    if (
      !context.payload.pull_request.labels.some(
        label => label.name === MERGE_ON_GREEN_LABEL
      )
    ) {
      app.log.info(
        `ignoring non-force label action (${context.payload.pull_request.labels.join(
          ', '
        )})`
      );
      return;
    }
    const number = context.payload.pull_request.number;
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    await addPR({
      number,
      owner,
      repo,
      state: 'continue'
    });
  });
};
