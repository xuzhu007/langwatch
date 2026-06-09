/**
 * @vitest-environment node
 *
 * 覆盖多 scope provider 删除的真实 Postgres 集成测试。
 */

import { generate } from "@langwatch/ksuid";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KSUID_RESOURCES } from "../../../utils/constants";

import { prisma } from "../../db";
import { ModelProviderRepository } from "../modelProvider.repository";
import {
  type AuthzContext,
  ModelProviderService,
} from "../modelProvider.service";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;
const hasCredentialsSecret = !!process.env.CREDENTIALS_SECRET;

describe.skipIf(isTestcontainersOnly || !hasCredentialsSecret)(
  "ModelProviderService scope-aware deletion (real DB)",
  () => {
    const ns = generate(KSUID_RESOURCES.MODEL_PROVIDER)
      .toString()
      .replace(/_/g, "-");

    let orgId: string;
    let otherOrgId: string;
    let teamId: string;
    let otherTeamId: string;
    let projectAId: string;
    let siblingProjectId: string;
    let otherProjectId: string;
    let orgAdminUserId: string;

    const repo = () => new ModelProviderRepository(prisma);
    const service = () => ModelProviderService.create(prisma);

    function ctxFor(userId: string): AuthzContext {
      return {
        prisma,
        session: { user: { id: userId }, expires: "1" },
      };
    }

    beforeAll(async () => {
      const org = await prisma.organization.create({
        data: { name: `Del Org ${ns}`, slug: `--del-${ns}` },
      });
      orgId = org.id;

      const otherOrg = await prisma.organization.create({
        data: { name: `Del Other Org ${ns}`, slug: `--del-other-${ns}` },
      });
      otherOrgId = otherOrg.id;

      const team = await prisma.team.create({
        data: {
          name: `Del Team ${ns}`,
          slug: `--del-team-${ns}`,
          organizationId: orgId,
        },
      });
      teamId = team.id;

      const otherTeam = await prisma.team.create({
        data: {
          name: `Del Other Team ${ns}`,
          slug: `--del-other-team-${ns}`,
          organizationId: otherOrgId,
        },
      });
      otherTeamId = otherTeam.id;

      const projectA = await prisma.project.create({
        data: {
          name: `Del Proj A ${ns}`,
          slug: `--del-proj-a-${ns}`,
          teamId,
          language: "typescript",
          framework: "other",
          apiKey: `del-key-a-${ns}`,
        },
      });
      projectAId = projectA.id;

      const siblingProject = await prisma.project.create({
        data: {
          name: `Del Proj Sibling ${ns}`,
          slug: `--del-proj-sib-${ns}`,
          teamId,
          language: "typescript",
          framework: "other",
          apiKey: `del-key-sib-${ns}`,
        },
      });
      siblingProjectId = siblingProject.id;

      const otherProject = await prisma.project.create({
        data: {
          name: `Del Proj Other ${ns}`,
          slug: `--del-proj-other-${ns}`,
          teamId: otherTeamId,
          language: "typescript",
          framework: "other",
          apiKey: `del-key-other-${ns}`,
        },
      });
      otherProjectId = otherProject.id;

      const orgAdmin = await prisma.user.create({
        data: {
          name: "Del Org Admin",
          email: `del-org-admin-${ns}@example.com`,
        },
      });
      orgAdminUserId = orgAdmin.id;
      await prisma.organizationUser.create({
        data: {
          userId: orgAdmin.id,
          organizationId: orgId,
          role: OrganizationUserRole.ADMIN,
        },
      });
      await prisma.roleBinding.create({
        data: {
          organizationId: orgId,
          userId: orgAdmin.id,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: orgId,
        },
      });
    });

    afterAll(async () => {
      const projectIds = [projectAId, siblingProjectId, otherProjectId].filter(
        Boolean,
      );
      await prisma.modelProvider
        .deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } })
        .catch(() => {});
      await prisma.roleBinding
        .deleteMany({ where: { organizationId: orgId } })
        .catch(() => {});
      await prisma.organizationUser
        .deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } })
        .catch(() => {});
      await prisma.project
        .deleteMany({ where: { id: { in: projectIds } } })
        .catch(() => {});
      await prisma.team
        .deleteMany({ where: { id: { in: [teamId, otherTeamId] } } })
        .catch(() => {});
      await prisma.organization
        .deleteMany({ where: { id: { in: [orgId, otherOrgId] } } })
        .catch(() => {});
      await prisma.user
        .deleteMany({ where: { email: `del-org-admin-${ns}@example.com` } })
        .catch(() => {});
    });

    it("deletes an organization-scoped provider from a project settings view", async () => {
      const created = await repo().create({
        projectId: projectAId,
        name: `OpenAI Org ${ns}`,
        provider: "openai",
        enabled: true,
        customKeys: { OPENAI_API_KEY: `sk-org-${ns}` },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
      });

      await service().deleteModelProvider(
        { id: created.id, projectId: projectAId, provider: "openai" },
        ctxFor(orgAdminUserId),
      );

      const row = await prisma.modelProvider.findUnique({
        where: { id: created.id },
      });
      expect(row).toBeNull();
      const scopes = await prisma.modelProviderScope.findMany({
        where: { modelProviderId: created.id },
      });
      expect(scopes).toHaveLength(0);
    });

    it("deletes a provider scoped only to a sibling project in the same organization", async () => {
      const created = await repo().create({
        projectId: siblingProjectId,
        name: `OpenAI Sibling ${ns}`,
        provider: "anthropic",
        enabled: true,
        customKeys: { ANTHROPIC_API_KEY: `sk-sib-${ns}` },
        scopes: [{ scopeType: "PROJECT", scopeId: siblingProjectId }],
      });

      await service().deleteModelProvider(
        { id: created.id, projectId: projectAId, provider: "anthropic" },
        ctxFor(orgAdminUserId),
      );

      const row = await prisma.modelProvider.findUnique({
        where: { id: created.id },
      });
      expect(row).toBeNull();
    });

    it("rejects a provider from another organization as NOT_FOUND", async () => {
      const created = await repo().create({
        projectId: otherProjectId,
        name: `OpenAI Other ${ns}`,
        provider: "openai",
        enabled: true,
        customKeys: { OPENAI_API_KEY: `sk-other-${ns}` },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: otherOrgId }],
      });

      await expect(
        service().deleteModelProvider(
          { id: created.id, projectId: projectAId, provider: "openai" },
          ctxFor(orgAdminUserId),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      const row = await prisma.modelProvider.findUnique({
        where: { id: created.id },
      });
      expect(row).not.toBeNull();
    });
  },
);
