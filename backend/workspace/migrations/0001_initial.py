from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [
        migrations.CreateModel(
            name="WorkspacePreferences",
            fields=[
                ("id", models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False)),
                ("theme", models.CharField(default="light", max_length=10)),
                ("display_name", models.CharField(blank=True, default="", max_length=60)),
                ("focus_minutes", models.PositiveSmallIntegerField(default=25)),
                ("break_minutes", models.PositiveSmallIntegerField(default=5)),
            ],
            options={
                "constraints": [
                    models.CheckConstraint(condition=models.Q(id=1), name="single_workspace_profile"),
                    models.CheckConstraint(condition=models.Q(theme__in=["light", "dark", "system"]), name="valid_workspace_theme"),
                    models.CheckConstraint(condition=models.Q(focus_minutes__gte=1, focus_minutes__lte=180), name="valid_focus_duration"),
                    models.CheckConstraint(condition=models.Q(break_minutes__gte=1, break_minutes__lte=60), name="valid_break_duration"),
                ]
            },
        ),
        migrations.CreateModel(
            name="QuickNote",
            fields=[
                ("id", models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False)),
                ("content", models.TextField(blank=True, default="")),
                ("updated_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={"constraints": [models.CheckConstraint(condition=models.Q(id=1), name="single_quick_note")]},
        ),
        migrations.CreateModel(
            name="ToolFavorite",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("tool_id", models.CharField(max_length=60, unique=True)),
                ("favorite", models.BooleanField(default=True)),
            ],
        ),
        migrations.CreateModel(
            name="Activity",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("tool_id", models.CharField(max_length=60)),
                ("action", models.CharField(max_length=160)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"ordering": ["-created_at", "-id"]},
        ),
    ]

