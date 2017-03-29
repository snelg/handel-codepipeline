const iamCalls = require('../aws/iam-calls');
const codeBuildCalls = require('../aws/codebuild-calls');
const util = require('../util/util');

function createBuildPhaseServiceRole(accountId) {
    let roleName = 'HandelCodePipelineBuildPhaseServiceRole'
    return iamCalls.createRoleIfNotExists(roleName, 'codebuild.amazonaws.com')
        .then(role => {
            let policyArn = `arn:aws:iam::${accountId}:policy/handel-codepipeline/${roleName}`;
            let policyDocument = {
                Version: "2012-10-17",
                Statement: [
                    {
                        Action: [
                            "codebuild:StartBuild",
                            "codebuild:StopBuild",
                            "codebuild:BatchGet*",
                            "codebuild:Get*",
                            "codebuild:List*",
                            "codecommit:GetBranch",
                            "codecommit:GetCommit",
                            "codecommit:GetRepository",
                            "codecommit:ListBranches",
                            "ecr:BatchCheckLayerAvailability",
                            "ecr:BatchGetImage",
                            "ecr:CompleteLayerUpload",
                            "ecr:DescribeImages",
                            "ecr:GetAuthorizationToken",
                            "ecr:GetDownloadUrlForLayer",
                            "ecr:InitiateLayerUpload",
                            "ecr:ListImages",
                            "ecr:PutImage",
                            "ecr:UploadLayerPart",
                            "events:PutRule",
                            "events:RemoveTargets",
                            "iam:CreateRole",
                            "iam:GetRole",
                            "iam:GetInstanceProfile",
                            "iam:PassRole",
                            "iam:ListInstanceProfiles",
                            "logs:*",
                            "s3:CreateBucket",
                            "s3:GetBucketLocation",
                            "s3:GetObject",
                            "s3:List*",
                            "s3:PutObject"
                        ],
                        Resource: "*",
                        Effect: "Allow"
                    },
                    {
                        Action: [
                            "logs:GetLogEvents"
                        ],
                        Resource: "arn:aws:logs:*:*:log-group:/aws/codebuild/*:log-stream:*",
                        Effect: "Allow"
                    }
                ]
            }
            return iamCalls.createPolicyIfNotExists(roleName, policyArn, policyDocument);
        })
        .then(policy => {
            return iamCalls.attachPolicyToRole(policy.Arn, roleName);
        })
        .then(policyAttachment => {
            return iamCalls.getRole(roleName);
        });
}

function createDeployPhaseServiceRole(accountId) {
    let roleName = 'HandelCodePipelineDeployPhaseServiceRole'
    return iamCalls.createRoleIfNotExists(roleName, 'codebuild.amazonaws.com')
        .then(role => {
            let policyArn = `arn:aws:iam::${accountId}:policy/handel-codepipeline/${roleName}`;
            let policyDocument = {
                Version: "2012-10-17",
                Statement: [
                    {
                        Action: [
                            '*'
                        ],
                        Resource: "*",
                        Effect: "Allow"
                    }
                ]
            }
            return iamCalls.createPolicyIfNotExists(roleName, policyArn, policyDocument);
        })
        .then(policy => {
            return iamCalls.attachPolicyToRole(policy.Arn, roleName);
        })
        .then(policyAttachment => {
            return iamCalls.getRole(roleName);
        });
}

function createBuildPhaseCodeBuildProject(accountId, projectName, buildPhase) {
    return createBuildPhaseServiceRole(accountId)
        .then(buildPhaseRole => {
            let buildProjectName = codeBuildCalls.getBuildProjectName(projectName);
            return codeBuildCalls.createProject(buildProjectName, projectName, buildPhase.build_image, buildPhase.environment_variables, accountId, buildPhaseRole.Arn);
        });
}

function createDeployPhaseCodeBuildProject(accountId, projectName, deployPhase, accountConfig) {
    return createDeployPhaseServiceRole(accountId)
        .then(deployPhaseRole => {
            let handelDeployEnvVars = {
                ENVS_TO_DEPLOY: deployPhase.envs.join(","),
                HANDEL_ACCOUNT_CONFIG: new Buffer(JSON.stringify(accountConfig)).toString("base64")
            }
            let handelDeployImage = "aws/codebuild/nodejs:6.3.1";
            let handelDeployBuildSpec = util.loadFile(`${__dirname}/deploy-buildspec.yml`);

            let deployProjectName = codeBuildCalls.getDeployProjectName(projectName, deployPhase.envs);
            return codeBuildCalls.createProject(deployProjectName, projectName, handelDeployImage, handelDeployEnvVars, accountId, deployPhaseRole.Arn, handelDeployBuildSpec);
        });
}

function createCodeBuildProjectsInAccount(accountId, projectName, pipelineDefinition, accountConfig) {
    let createPromises = [];

    //Create deploy phase projects
    for(let i = 2; i < pipelineDefinition.phases.length; i++) {
        let phase = pipelineDefinition.phases[i];
        if(phase.phase_type === 'deploy') {
            createPromises.push(createDeployPhaseCodeBuildProject(accountId, projectName, phase, accountConfig));
        }
    }
    
    //Create build phase project
    let buildPhase = pipelineDefinition.phases[1];
    createPromises.push(createBuildPhaseCodeBuildProject(accountId, projectName, buildPhase));

    return Promise.all(createPromises);
}

exports.createCodeBuildProjects = function(handelCodePipelineFile, handelFile, accountConfigs) {
    let createProjectPromises = [];
    let returnProjects = {};

    for(let accountId in handelCodePipelineFile.pipelines) {
        let pipelineDefinition = handelCodePipelineFile.pipelines[accountId];
        let accountConfig = accountConfigs[accountId];
        let createProjectPromise = createCodeBuildProjectsInAccount(accountId, handelFile.name, pipelineDefinition, accountConfig)
            .then(project => {
                returnProjects[accountId] = project;
            });
        createProjectPromises.push(createProjectPromise);
    }

    return Promise.all(createProjectPromises)
        .then(createResult => {
            return returnProjects; //This is built-up dynamically above
        })
}