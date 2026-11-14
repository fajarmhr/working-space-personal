from django.test import SimpleTestCase, override_settings

from workspace.checks import api_csrf_protection


class DeploymentCheckTests(SimpleTestCase):
    def test_missing_api_csrf_middleware_fails_deployment_check(self):
        self.assertEqual(api_csrf_protection(None), [])
        with override_settings(MIDDLEWARE=["django.middleware.csrf.CsrfViewMiddleware"]):
            errors = api_csrf_protection(None)
        self.assertEqual([error.id for error in errors], ["ruang.E001"])

