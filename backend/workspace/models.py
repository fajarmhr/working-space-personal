from django.db import models


class WorkspacePreferences(models.Model):
    """A single local profile; no account or remote identity is required."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    theme = models.CharField(max_length=10, default="light")
    display_name = models.CharField(max_length=60, blank=True, default="")
    focus_minutes = models.PositiveSmallIntegerField(default=25)
    break_minutes = models.PositiveSmallIntegerField(default=5)
    huawei_enabled = models.BooleanField(default=False)
    active_workspace = models.CharField(max_length=10, default="personal")

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(id=1), name="single_workspace_profile"),
            models.CheckConstraint(
                condition=models.Q(theme__in=["light", "dark", "system"]),
                name="valid_workspace_theme",
            ),
            models.CheckConstraint(
                condition=models.Q(focus_minutes__gte=1, focus_minutes__lte=180),
                name="valid_focus_duration",
            ),
            models.CheckConstraint(
                condition=models.Q(break_minutes__gte=1, break_minutes__lte=60),
                name="valid_break_duration",
            ),
            models.CheckConstraint(
                condition=models.Q(active_workspace__in=["personal", "huawei"]),
                name="valid_active_workspace",
            ),
            models.CheckConstraint(
                condition=models.Q(huawei_enabled=True) | models.Q(active_workspace="personal"),
                name="active_huawei_requires_enabled",
            ),
        ]


class QuickNote(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    content = models.TextField(blank=True, default="")
    updated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(id=1), name="single_quick_note"),
        ]


class ToolFavorite(models.Model):
    tool_id = models.CharField(max_length=60, unique=True)
    favorite = models.BooleanField(default=True)


class Activity(models.Model):
    tool_id = models.CharField(max_length=60)
    action = models.CharField(max_length=160)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class DailyTask(models.Model):
    title = models.CharField(max_length=180)
    details = models.TextField(blank=True, default="")
    priority = models.CharField(max_length=10, default="normal")
    due_date = models.DateField(null=True, blank=True)
    completed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["completed", "-created_at", "-id"]
        constraints = [
            models.CheckConstraint(condition=~models.Q(title=""), name="task_title_not_empty"),
            models.CheckConstraint(
                condition=models.Q(priority__in=["low", "normal", "high"]),
                name="valid_task_priority",
            ),
        ]


class Snippet(models.Model):
    title = models.CharField(max_length=120)
    content = models.TextField()
    category = models.CharField(max_length=40, default="Umum")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        constraints = [
            models.CheckConstraint(condition=~models.Q(title=""), name="snippet_title_not_empty"),
            models.CheckConstraint(condition=~models.Q(content=""), name="snippet_content_not_empty"),
            models.CheckConstraint(condition=~models.Q(category=""), name="snippet_category_not_empty"),
        ]


class HuaweiReportingDraft(models.Model):
    """One inactive reporting draft for this local installation, without secrets."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    config = models.JSONField(default=dict)
    revision = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(id=1), name="single_huawei_reporting_draft"),
        ]

