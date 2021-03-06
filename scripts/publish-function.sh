#!/bin/bash
# Copyright 2020 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -eo pipefail

if [ $# -lt 6 ]; then
  echo "Usage: $0 <botDirectory> <projectId> <bucket> <keyLocation> <keyRing> <functionRegion> [functionRuntime]"
  exit 1
fi

directoryName=$1
project=$2
bucket=$3
keyLocation=$4
keyRing=$5
functionRegion=$6

# To use a different runtime for a bot, give 7th parameter in bot's
# cloudbuild.yaml.
if [ $# -eq 7 ]; then
    functionRuntime=$7
else
    functionRuntime=nodejs10
fi

botName=$(echo "${directoryName}" | rev | cut -d/ -f1 | rev)
workdir=$(pwd)
targetDir="${workdir}/targets/${botName}"

pushd "${targetDir}"
functionName=${botName//-/_}
queueName=${botName//_/-}

echo "About to publish function ${functionName}"
gcloud functions deploy "${functionName}" \
  --trigger-http \
  --runtime "${functionRuntime}" \
  --region "${functionRegion}" \
  --set-env-vars DRIFT_PRO_BUCKET="${bucket}",KEY_LOCATION="${keyLocation}",KEY_RING="${keyRing}",GCF_SHORT_FUNCTION_NAME="${functionName}",PROJECT_ID="${project}",GCF_LOCATION="${functionRegion}",PUPPETEER_SKIP_CHROMIUM_DOWNLOAD='1',WEBHOOK_TMP=tmp-webhook-payloads

echo "Deploying Queue ${queueName}"

verb="create"
if gcloud tasks queues describe "${queueName}"  &>/dev/null; then
  verb="update"
fi

gcloud tasks queues ${verb} "${queueName}" \
  --max-concurrent-dispatches="2048" \
  --max-attempts="100" \
  --max-dispatches-per-second="500"
