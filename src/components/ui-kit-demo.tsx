"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Textarea, DateField } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox, Radio, Switch } from "@/components/ui/choice";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Alert } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Toast } from "@/components/ui/toast";
import { Avatar, Divider, EmptyState, FileUpload, Skeleton } from "@/components/ui/misc";
import { Menu, Search } from "lucide-react";

const demoSchema = z.object({ name: z.string().min(1, "请输入示例名称") });

export function UIKitDemo() {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [toastOpen, setToastOpen] = React.useState(false);
  const {
    register,
    formState: { errors },
  } = useForm({ resolver: zodResolver(demoSchema), defaultValues: { name: "" } });

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-card px-4 py-4 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
              CrewQual foundation
            </p>
            <h1 className="mt-1 text-xl font-bold text-primary">UI Kit 设计系统验收</h1>
            <p className="mt-1 text-sm text-secondary">
              来自 Figma 的浅色主题、响应式组件和可访问交互状态。
            </p>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <IconButton label="搜索组件" variant="secondary">
              <Search aria-hidden="true" className="size-4" />
            </IconButton>
            <Avatar initials="CQ" label="CrewQual" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-8 p-4 pb-12 lg:p-8">
        <section aria-labelledby="buttons-title">
          <SectionTitle
            id="buttons-title"
            eyebrow="01"
            title="Buttons & actions"
            description="所有操作目标保持至少 44px 的触控高度。"
          />
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link action</Button>
              <Button loading>Loading</Button>
              <Button disabled>Disabled</Button>
              <IconButton label="菜单" variant="secondary">
                <Menu aria-hidden="true" className="size-4" />
              </IconButton>
            </CardContent>
          </Card>
        </section>
        <section aria-labelledby="forms-title">
          <SectionTitle
            id="forms-title"
            eyebrow="02"
            title="Form controls"
            description="标签、必填标记、辅助文本、错误、禁用与焦点状态。"
          />
          <Card>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <Input
                label="证件名称"
                required
                placeholder="请输入资质项目名称"
                helperText="示例：年度复训合格证"
              />
              <Input
                label="校验错误"
                error="字段内容不能为空"
                placeholder="展示 error 与 aria-invalid"
              />
              <DateField label="签发日期" required helperText="yyyy-mm-dd" />
              <Select
                label="资质类型"
                required
                options={[
                  { label: "请选择类型", value: "" },
                  { label: "训练资质", value: "training" },
                  { label: "语言能力", value: "language" },
                ]}
              />
              <Textarea label="备注" placeholder="输入一段较长的中文说明，观察文字换行和布局。" />
              <div className="space-y-3">
                <Checkbox label="我已核对示例信息" helperText="Mock 数据仅用于界面验收" />
                <Radio name="demo-radio" label="通过" defaultChecked />
                <Radio name="demo-radio" label="待复核" />
                <Switch label="开启 AI 辅助审核" helperText="第一批仅展示开关，不连接真实服务" />
              </div>
              <div className="md:col-span-2">
                <label className="sr-only" htmlFor="rhf-name">
                  React Hook Form 示例名称
                </label>
                <input
                  id="rhf-name"
                  className="sr-only"
                  {...register("name")}
                  aria-invalid={Boolean(errors.name)}
                />
                <p className="text-xs text-muted">
                  React Hook Form + Zod 已接入当前验收页的表单校验边界。
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
        <section aria-labelledby="status-title">
          <SectionTitle
            id="status-title"
            eyebrow="03"
            title="Status, feedback & data"
            description="覆盖资质、AI 辅助审核与常见反馈状态。"
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <h3 className="text-sm font-semibold">状态标签</h3>
                  <p className="mt-1 text-xs text-muted">不同长度中文文案</p>
                </div>
                <Badge tone="info">共 8 项</Badge>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <StatusBadge status="success">匹配通过</StatusBadge>
                <StatusBadge status="warning">有效期存疑</StatusBadge>
                <StatusBadge status="danger">信息不一致</StatusBadge>
                <StatusBadge status="info">AI 辅助审核</StatusBadge>
                <StatusBadge status="purple">计划异常跟进</StatusBadge>
                <StatusBadge status="neutral">长期有效</StatusBadge>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-5">
                <Progress value={68} label="资质核验进度" />
                <Progress value={100} label="材料完整度" />
                <Alert tone="info" title="AI 辅助审核（可选）">
                  AI
                  可从凭证中辅助识别并引入日期，其他信息由您手动填写。所有内容均可修改，请在提交前核对。
                </Alert>
                <Alert tone="success">资料匹配通过，可进入人工复核。</Alert>
                <Alert tone="warning">有效期存疑，请确认原始凭证。</Alert>
                <Alert tone="danger">信息不一致，暂不能提交。</Alert>
              </CardContent>
            </Card>
          </div>
          <Card className="mt-4">
            <CardContent>
              <Tabs defaultValue="tokens">
                <TabsList>
                  <TabsTrigger value="tokens">令牌</TabsTrigger>
                  <TabsTrigger value="states">状态说明</TabsTrigger>
                </TabsList>
                <TabsContent value="tokens">
                  <p className="text-sm text-secondary">
                    所有组件消费语义化颜色、圆角、阴影与层级令牌。
                  </p>
                </TabsContent>
                <TabsContent value="states">
                  <p className="text-sm text-secondary">
                    状态文案保持与 Figma 层级一致，业务数据留待后续批次。
                  </p>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </section>
        <section aria-labelledby="overlay-title">
          <SectionTitle
            id="overlay-title"
            eyebrow="04"
            title="Overlay & loading"
            description="Dialog、Drawer、Toast、Skeleton、空状态和上传区域。"
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="flex flex-wrap gap-3">
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>打开 Dialog</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogTitle>确认示例操作</DialogTitle>
                    <DialogDescription className="mt-2 text-sm text-secondary">
                      这是基于 Radix Dialog 的可访问交互样例，可以用 Escape 关闭。
                    </DialogDescription>
                    <div className="mt-5 flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                        取消
                      </Button>
                      <Button onClick={() => setDialogOpen(false)}>确认</Button>
                    </div>
                  </DialogContent>
                </Dialog>
                <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
                  <DrawerTrigger asChild>
                    <Button variant="secondary">打开 Drawer</Button>
                  </DrawerTrigger>
                  <DrawerContent className="p-6">
                    <DrawerTitle className="text-lg font-semibold">移动端抽屉</DrawerTitle>
                    <DrawerDescription className="mt-2 text-sm text-secondary">
                      适用于移动导航和辅助操作。
                    </DrawerDescription>
                    <div className="mt-6">
                      <Button onClick={() => setDrawerOpen(false)}>关闭抽屉</Button>
                    </div>
                  </DrawerContent>
                </Drawer>
                <Button variant="ghost" onClick={() => setToastOpen(true)}>
                  显示 Toast
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Skeleton className="h-20" />
                  <Skeleton className="h-20" />
                  <Skeleton className="h-20" />
                </div>
                <Divider />
                <FileUpload />
                <EmptyState
                  title="暂无待处理事项"
                  description="当有新的资质更新时，内容会出现在这里。"
                  action={
                    <Button variant="secondary" size="sm">
                      刷新列表
                    </Button>
                  }
                />
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
      <Toast open={toastOpen} title="已保存示例设置" onClose={() => setToastOpen(false)}>
        当前仅在本地展示 Toast，不产生网络请求。
      </Toast>
    </div>
  );
}

function SectionTitle({
  id,
  eyebrow,
  title,
  description,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">{eyebrow}</p>
      <h2 id={id} className="mt-1 text-base font-bold text-primary">
        {title}
      </h2>
      <p className="mt-1 text-sm text-secondary">{description}</p>
    </div>
  );
}
